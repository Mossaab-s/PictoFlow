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
    display_name: "Relecture personnelle fictive",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Profil privé de relecture" })
).id;
const base = `profiles/${p}`;
const user = await call("auth/users", "POST", {
  username: "review-ci-user",
  display_name: "Accompagnement fictif",
  password,
});
const grant = `auth/users/${user.id}/profiles/${p}/capabilities`;
await call(grant, "PUT", {
  capabilities: ["review_meanings"],
  expected_capabilities: null,
});
const candidates = {};
for (const [label, pictogram_key] of [
  ["Eau", "water"],
  ["Livre", "book"],
  ["Maman", "mother"],
  ["Boire", "drink"],
  ["Pain", "bread"],
  ["Chat", "cat"],
  ["Toilettes", "toilets"],
  ["Maison", "home"],
]) {
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    actor_role: "user",
    pictogram_key,
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  const sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  for (const data of [
    { action: "append", block_id: block.id },
    { action: "complete" },
  ])
    await call(base + `/sequences/${sequence.id}/selection`, "POST", data);
  candidates[label] = (
    await call(base + `/sequences/${sequence.id}/interpret`, "POST", {})
  ).candidates[0];
  if (label === "Toilettes")
    candidates.alternative = (
      await call(base + `/sequences/${sequence.id}/interpret`, "POST", {})
    ).candidates[0];
}
const beforeKeyboard = await call(base + "/keyboard");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
// This scenario exercises the detailed tools available from Options.
await page.addInitScript(() => {
  try {
    sessionStorage.setItem("pictoflow:communication-view", "tools");
  } catch {
    /* Optional UI preference. */
  }
});
const errors = [];
const writes = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (req) => {
  if (req.method() === "POST")
    writes.push({ url: req.url(), data: req.postDataJSON() });
});
const card = (text) => page.getByRole("article", { name: text, exact: true });
const current = (label) =>
  call(base + `/interpretations/${candidates[label].id}`);
const facts = async (id) =>
  (
    await call(
      base + `/feedback?target_type=interpretation&target_id=${id}&limit=20`,
    )
  ).items;
await fs.mkdir(".local/support-review", { recursive: true });
try {
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page.locator(".person-card").click();
  await page
    .getByRole("navigation", { name: "Activités de la personne", exact: true })
    .getByRole("link", { name: "Phrases à vérifier", exact: true })
    .click();
  await expect(page).toHaveURL(
    `${origin}/accompagnement/personnes/${p}/a-verifier`,
  );
  await expect(page.locator(".review-message")).toHaveCount(8);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  assert.equal(
    await page
      .getByRole("link", { name: "Administration", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.locator("pre,.identifier").count(), 0);
  await page.screenshot({ path: ".local/support-review/queue-tablet.png" });

  const reads = [];
  const watch = (req) => {
    if (req.url().includes(`/api/pictoflow/profiles/${other}/`))
      reads.push(req.url());
  };
  page.on("request", watch);
  await page.goto(`${origin}/accompagnement/personnes/${other}/a-verifier`);
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(reads, []);
  page.off("request", watch);
  await page.goto(`${origin}/accompagnement/personnes/${p}/a-verifier`);
  await card("Eau")
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByText("Phrase confirmée dans la mémoire du profil.", { exact: true })
    .waitFor();
  assert.equal((await current("Eau")).status, "confirmed");
  assert.equal((await facts(candidates.Eau.id)).length, 1);
  await page.locator(".role-selector select").selectOption("professional");
  await card("Livre")
    .getByText("Corriger cette phrase", { exact: true })
    .click();
  await card("Livre")
    .getByLabel("Phrase corrigée", { exact: true })
    .fill("Je voudrais lire mon livre.");
  await card("Livre")
    .getByRole("button", { name: "Enregistrer la correction", exact: true })
    .click();
  await page
    .getByText("Votre correction est enregistrée dans la mémoire du profil.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await current("Livre")).corrected_text,
    "Je voudrais lire mon livre.",
  );
  assert.equal(
    (await facts(candidates.Livre.id))[0].actor_role,
    "professional",
  );
  await card("Maman")
    .getByRole("button", { name: "Refuser cette phrase", exact: true })
    .click();
  await page
    .getByText("Phrase refusée. Elle n’entre pas dans les phrases acceptées.", {
      exact: true,
    })
    .waitFor();
  assert.equal((await current("Maman")).status, "rejected");
  assert.equal((await call(base + "/memory")).interpretations.length, 2);
  await page
    .getByRole("button", { name: "Décisions enregistrées", exact: true })
    .click();
  await expect(page.locator(".review-phrase")).toHaveCount(3);
  assert.equal(
    await page
      .getByRole("button", { name: "Confirmer cette phrase", exact: true })
      .count(),
    0,
  );
  await card("Je voudrais lire mon livre.")
    .getByText("Voir les décisions humaines", { exact: true })
    .click();
  await card("Je voudrais lire mon livre.")
    .getByText("Professionnel", { exact: false })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: ".local/support-review/decisions-mobile.png" });
  await page.getByRole("button", { name: "À vérifier", exact: true }).click();

  // Another reviewer corrects the phrase while this page still holds its proposal.
  await call(
    base + `/interpretations/${candidates.Boire.id}/feedback`,
    "POST",
    {
      action: "correct",
      corrected_value: "Mon autre choix.",
      actor_role: "caregiver",
    },
  );
  await card("Boire")
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Ce message a déjà été traité" })
    .waitFor();
  assert.equal((await current("Boire")).corrected_text, "Mon autre choix.");
  assert.equal((await facts(candidates.Boire.id)).length, 1);
  await card("Toilettes")
    .first()
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByText("Phrase confirmée dans la mémoire du profil.", { exact: true })
    .waitFor();
  assert.equal(await card("Toilettes").count(), 0);
  const alternatives = await Promise.all([
    current("Toilettes"),
    call(base + `/interpretations/${candidates.alternative.id}`),
  ]);
  assert.deepEqual(alternatives.map((item) => item.status).sort(), [
    "confirmed",
    "proposed",
  ]);

  // Commit the decision, then lose its HTTP response: the UI reconciles without resending.
  const painFeedback =
    origin +
    `/api/pictoflow/${base}/interpretations/${candidates.Pain.id}/feedback`;
  await page.route(painFeedback, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort("failed");
  });
  await card("Pain")
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "La réponse n’a pas pu être confirmée" })
    .waitFor();
  await page.unroute(painFeedback);
  assert.equal((await current("Pain")).status, "confirmed");
  assert.equal((await facts(candidates.Pain.id)).length, 1);
  assert.equal(writes.filter((item) => item.url === painFeedback).length, 1);

  const listURL = origin + `/api/pictoflow/${base}/interpretations`;
  await page.route(listURL, (route) =>
    route.fulfill({ status: 503, json: { detail: "Synthetic read outage" } }),
  );
  await card("Maison")
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "La liste ne peut pas être vérifiée" })
    .waitFor();
  await expect(
    card("Chat").getByRole("button", {
      name: "Confirmer cette phrase",
      exact: true,
    }),
  ).toBeDisabled();
  assert.equal((await facts(candidates.Maison.id)).length, 1);
  await page.unroute(listURL);
  await page
    .getByRole("button", { name: "Actualiser les phrases", exact: true })
    .click();
  await expect(
    card("Chat").getByRole("button", {
      name: "Confirmer cette phrase",
      exact: true,
    }),
  ).toBeEnabled();
  assert.deepEqual(await call(base + "/keyboard"), beforeKeyboard);
  assert.equal(
    writes.filter((item) =>
      /\/(sequences|interpret)$/.test(new URL(item.url).pathname),
    ).length,
    0,
  );
  await page.screenshot({ path: ".local/support-review/queue-mobile.png" });

  await call(grant, "PUT", {
    capabilities: ["view_history"],
    expected_capabilities: ["review_meanings"],
  });
  await card("Chat")
    .getByRole("button", { name: "Confirmer cette phrase", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.equal((await current("Chat")).status, "proposed");
  assert.equal((await facts(candidates.Chat.id)).length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated supporter review verified: explicit decisions, evidence, profile isolation, stale decisions, resolved siblings, lost responses, read outage, revocation and unchanged keyboard.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/support-review/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
