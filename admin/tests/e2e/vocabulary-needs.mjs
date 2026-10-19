import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3132";
const password = "Synthetic capability CI passphrase";
const admin = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const login = await admin.post("/api/pictoflow/auth/login", {
  data: { username: "capability-ci-admin", password },
});
assert(login.ok());
const csrf = (await login.json()).csrf_token;
async function call(path, method = "GET", data) {
  const response = await admin.fetch("/api/pictoflow/" + path, {
    method,
    headers: { "X-CSRF-Token": csrf },
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
const p = (
  await call("profiles", "POST", {
    display_name: "Besoins de vocabulaire fictifs",
  })
).id;
const foreign = (
  await call("profiles", "POST", {
    display_name: "Autre personne fictive",
  })
).id;
const base = `profiles/${p}`;
const user = await call("auth/users", "POST", {
  username: "needs-ci-user",
  display_name: "Accompagnement fictif",
  password,
});
const grant = `auth/users/${user.id}/profiles/${p}/capabilities`;
await call(grant, "PUT", {
  capabilities: ["manage_meanings", "prepare_keyboard"],
  expected_capabilities: null,
});
const blocks = {};
for (const [label, key] of [
  ["Boire", "drink"],
  ["Eau", "water"],
  ["Maison", "home"],
  ["Livre", "book"],
  ["Maman", "mother"],
  ["Jouet", "toy"],
  ["Stop", "stop"],
]) {
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: key,
    actor_role: "user",
  });
  blocks[key] = block.id;
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
}
const groups = [
  { keys: ["drink", "water"], text: "Je voudrais boire de l’eau." },
  { keys: ["home", "book"], text: "Je voudrais lire à la maison." },
  { keys: ["mother", "toy"], text: "J’ai besoin de mon ours." },
  { keys: ["stop", "home"], text: "Je veux rentrer à la maison." },
  { keys: ["water", "home"], text: "Je voudrais de l’eau à la maison." },
];
for (const group of groups) {
  group.candidates = [];
  for (let i = 0; i < 5; i++) {
    const sequence = await call(base + "/sequences", "POST", {
      session_id: crypto.randomUUID(),
    });
    const path = base + `/sequences/${sequence.id}`;
    for (const key of group.keys)
      await call(path + "/selection", "POST", {
        action: "append",
        block_id: blocks[key],
      });
    await call(path + "/selection", "POST", { action: "complete" });
    const candidate = (await call(path + "/interpret", "POST", {}))
      .candidates[0];
    await call(base + `/interpretations/${candidate.id}/feedback`, "POST", {
      action: "correct",
      corrected_value: group.text,
      actor_role: "user",
    });
    group.candidates.push(candidate);
  }
}
const beforeKeyboard = await call(base + "/keyboard");
const beforeBlocks = await call(base + "/blocks");
assert.deepEqual(await call(base + "/suggestions"), []);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
const writes = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (req) => {
  if (req.url().includes("/api/pictoflow/profiles/") && req.method() !== "GET")
    writes.push({ url: req.url(), body: req.postDataJSON() });
});
const url = `${origin}/accompagnement/personnes/${p}/propositions`;
const card = (group) =>
  page.getByRole("article", { name: group.text, exact: true });
const button = (label) =>
  page.getByRole("button", { name: label, exact: true });
async function refresh() {
  await button("Actualiser les besoins").click();
  await expect(button("Actualiser les besoins")).toBeEnabled();
}
async function evidence(group) {
  await card(group)
    .getByText("Comprendre ce besoin et voir les exemples", { exact: true })
    .click();
  await expect(card(group).locator(".need-examples li")).toHaveCount(5);
}
async function current(group) {
  return (await call(base + "/suggestions")).find(
    (item) => item.id === group.need.id,
  );
}
async function decisions(group) {
  return (
    await call(
      base +
        `/audit?target_type=semantic_gap_candidate&target_id=${group.need.id}`,
    )
  ).filter((item) =>
    ["semantic_gap_approved", "semantic_gap_rejected"].includes(
      item.event_type,
    ),
  );
}
async function noOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
}
await fs.mkdir(".local/vocabulary-needs", { recursive: true });
try {
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await button("Se connecter").click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Aucun besoin à examiner", exact: true })
    .waitFor();
  assert.deepEqual(writes, []);
  await button("Rechercher les expressions répétées").click();
  await expect(page.locator(".vocabulary-need")).toHaveCount(5);
  for (const group of groups)
    group.need = (await call(base + "/suggestions")).find(
      (item) => item.validated_intent === group.text,
    );
  await expect(button("Rechercher les expressions répétées")).toBeEnabled();
  await page
    .getByLabel("Rechercher une expression", { exact: true })
    .fill("boire");
  await expect(page.locator(".vocabulary-need")).toHaveCount(1);
  await page.getByLabel("Rechercher une expression", { exact: true }).fill("");
  await evidence(groups[0]);
  await expect(
    card(groups[0]).locator(".memory-touches .touch-word"),
  ).toHaveText(["Boire", "Eau"]);
  await expect(
    card(groups[0]).getByText(
      "Le repérage demande au moins 5 répétitions et 4 phrases acceptées.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(await page.locator("pre,.identifier").count(), 0);
  await page
    .getByLabel("Je prends la décision en tant que", { exact: true })
    .selectOption("professional");
  await noOverflow();
  await card(groups[0]).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/vocabulary-needs/evidence-tablet.png",
  });
  await card(groups[0])
    .getByRole("button", { name: "Accepter ce besoin", exact: true })
    .click();
  await page
    .getByText(
      "Besoin accepté. Retrouvez-le dans le suivi pour préparer une touche.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await current(groups[0])).status, "approved");
  assert.equal((await decisions(groups[0]))[0].source, "human:professional");
  await button("Suivi des décisions").click();
  const editor = card(groups[0]).getByRole("link", {
    name: "Ouvrir la préparation du clavier",
    exact: true,
  });
  await expect(editor).toHaveAttribute(
    "href",
    `/accompagnement/personnes/${p}/clavier`,
  );
  await editor.click();
  await expect(page).toHaveURL(
    `${origin}/accompagnement/personnes/${p}/clavier`,
  );
  await page.goto(url);
  await evidence(groups[1]);
  await card(groups[1])
    .getByRole("button", { name: "Refuser ce besoin", exact: true })
    .click();
  await page
    .getByText("Besoin refusé. La décision reste dans le suivi.", {
      exact: true,
    })
    .waitFor();
  assert.equal((await current(groups[1])).status, "rejected");

  // A pending screen must not overwrite another person's recorded decision.
  await evidence(groups[2]);
  await call(base + `/suggestions/${groups[2].need.id}/decision`, "POST", {
    approve: false,
    actor_role: "user",
    expected_status: "proposed",
  });
  await card(groups[2])
    .getByRole("button", { name: "Accepter ce besoin", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Ce besoin a déjà été traité" })
    .waitFor();
  assert.equal((await current(groups[2])).status, "rejected");
  assert.equal((await decisions(groups[2])).length, 1);

  // Evidence withdrawn after opening the card is rechecked by the real API.
  await evidence(groups[3]);
  for (const candidate of groups[3].candidates.slice(0, 3))
    await call(base + `/interpretations/${candidate.id}/feedback`, "POST", {
      action: "reject",
      actor_role: "user",
    });
  await card(groups[3])
    .getByRole("button", { name: "Accepter ce besoin", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "L’action n’a pas pu être confirmée" })
    .waitFor();
  assert.equal((await current(groups[3])).status, "proposed");
  assert.equal((await decisions(groups[3])).length, 0);
  await card(groups[3])
    .getByText("Comprendre ce besoin et voir les exemples", { exact: true })
    .click();
  await expect(card(groups[3]).locator(".need-examples li")).toHaveCount(2);
  await expect(
    card(groups[3]).getByRole("button", {
      name: "Accepter ce besoin",
      exact: true,
    }),
  ).toBeDisabled();

  // No decision is possible after an evidence read fails; retry is explicit.
  const evidenceURL = `${origin}/api/pictoflow/${base}/suggestions/${groups[4].need.id}/evidence`;
  await page.route(evidenceURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic evidence outage" },
    }),
  );
  await card(groups[4])
    .getByText("Comprendre ce besoin et voir les exemples", { exact: true })
    .click();
  await card(groups[4]).getByRole("alert").waitFor();
  assert.equal(
    await card(groups[4])
      .getByRole("button", { name: "Accepter ce besoin", exact: true })
      .count(),
    0,
  );
  await page.unroute(evidenceURL);
  await card(groups[4])
    .getByRole("button", { name: "Recharger les exemples", exact: true })
    .click();
  await expect(card(groups[4]).locator(".need-examples li")).toHaveCount(5);

  // Commit, then lose the response: reconcile without a second POST.
  const decisionURL = `${origin}/api/pictoflow/${base}/suggestions/${groups[4].need.id}/decision`;
  await page.route(decisionURL, async (route) => {
    assert.equal((await route.fetch()).status(), 200);
    await route.abort("failed");
  });
  await card(groups[4])
    .getByRole("button", { name: "Accepter ce besoin", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "L’action n’a pas pu être confirmée" })
    .waitFor();
  await page.unroute(decisionURL);
  assert.equal((await current(groups[4])).status, "approved");
  assert.equal((await decisions(groups[4])).length, 1);
  assert.equal(writes.filter((item) => item.url === decisionURL).length, 1);

  const listURL = `${origin}/api/pictoflow/${base}/suggestions`;
  await page.route(listURL, (route) =>
    route.fulfill({ status: 503, json: { detail: "Synthetic list outage" } }),
  );
  await refresh();
  await page
    .getByRole("alert")
    .filter({ hasText: "ne peuvent pas être vérifiés" })
    .waitFor();
  assert.equal(await page.locator(".vocabulary-need").count(), 0);
  await expect(button("Rechercher les expressions répétées")).toBeDisabled();
  await page.unroute(listURL);
  await refresh();
  await expect(page.locator(".vocabulary-need")).toHaveCount(1);

  // Live revocation is enforced server-side, including a forged human role.
  await card(groups[3])
    .getByText("Comprendre ce besoin et voir les exemples", { exact: true })
    .click();
  await expect(card(groups[3]).locator(".need-examples li")).toHaveCount(2);
  await call(grant, "PUT", {
    capabilities: ["prepare_keyboard"],
    expected_capabilities: ["manage_meanings", "prepare_keyboard"],
  });
  await card(groups[3])
    .getByRole("button", { name: "Refuser ce besoin", exact: true })
    .click();
  await expect(
    page.getByLabel("Je prends la décision en tant que", { exact: true }),
  ).toHaveCount(0);
  await expect(button("Actualiser les besoins")).toBeEnabled();
  assert.equal((await current(groups[3])).status, "proposed");
  assert.equal((await decisions(groups[3])).length, 0);
  await call(grant, "PUT", {
    capabilities: ["view_history"],
    expected_capabilities: ["prepare_keyboard"],
  });
  await page.goto(url);
  await expect(button("Rechercher les expressions répétées")).toHaveCount(0);
  await card(groups[3])
    .getByText("Comprendre ce besoin et voir les exemples", { exact: true })
    .click();
  await expect(card(groups[3]).locator(".need-examples li")).toHaveCount(2);
  assert.equal(await button("Refuser ce besoin").count(), 0);
  await button("Suivi des décisions").click();
  await expect(page.locator(".vocabulary-need")).toHaveCount(4);
  assert.equal(
    await page
      .getByRole("link", {
        name: "Ouvrir la préparation du clavier",
        exact: true,
      })
      .count(),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.screenshot({
    path: ".local/vocabulary-needs/decisions-mobile.png",
  });

  const foreignReads = [];
  page.on("request", (req) => {
    if (req.url().includes(`/api/pictoflow/profiles/${foreign}/`))
      foreignReads.push(req.url());
  });
  await page.goto(`${origin}/accompagnement/personnes/${foreign}/propositions`);
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(foreignReads, []);
  assert.deepEqual(await call(base + "/keyboard"), beforeKeyboard);
  assert.deepEqual(await call(base + "/blocks"), beforeBlocks);
  assert(
    writes.every((item) =>
      /\/suggestions\/(detect|[^/]+\/decision)$/.test(
        new URL(item.url).pathname,
      ),
    ),
  );
  assert(
    writes
      .filter((item) => item.url.endsWith("/decision"))
      .every((item) => item.body.expected_status === "proposed"),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Vocabulary needs verified with real authenticated API: explicit detection and decisions, current accepted evidence, stale reviews, withdrawn evidence, lost response, read failures, live revocation, read-only history and unchanged keys.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/vocabulary-needs/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
