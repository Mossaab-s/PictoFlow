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
const profile = (
  await call("profiles", "POST", { display_name: "Besoins illustrés fictifs" })
).id;
const base = `profiles/${profile}`;
const sourceBlocks = [];
for (const [label, pictogram_key] of [
  ["Boire", "drink"],
  ["Eau", "water"],
  ["Maison", "home"],
]) {
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key,
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  sourceBlocks.push(block.id);
}
await call(base + `/keyboard/${sourceBlocks[0]}`, "PUT", {
  zone: "stable",
  position: 0,
  actor_role: "user",
});
const initialStable = (await call(base + "/keyboard")).filter(
  (p) => p.zone === "stable",
);
const expressions = [
  "Je voudrais boire de l’eau.",
  "Je voudrais de l’eau à la maison.",
  "Je voudrais rentrer à la maison.",
];
const pairs = [
  [0, 1],
  [1, 2],
  [2, 0],
];
const candidates = [];
for (let n = 0; n < expressions.length; n++) {
  candidates[n] = [];
  for (let i = 0; i < 5; i++) {
    const sequence = await call(base + "/sequences", "POST", {
      session_id: crypto.randomUUID(),
    });
    const path = base + `/sequences/${sequence.id}`;
    for (const index of pairs[n])
      await call(path + "/selection", "POST", {
        action: "append",
        block_id: sourceBlocks[index],
      });
    await call(path + "/selection", "POST", { action: "complete" });
    const candidate = (await call(path + "/interpret", "POST", {}))
      .candidates[0];
    await call(base + `/interpretations/${candidate.id}/feedback`, "POST", {
      action: "correct",
      corrected_value: expressions[n],
      actor_role: "user",
    });
    candidates[n].push(candidate.id);
  }
}
const needs = await call(base + "/suggestions/detect", "POST");
assert.equal(needs.length, 3);
const need = (n) =>
  needs.find((item) => item.validated_intent === expressions[n]);
for (const item of needs)
  await call(base + `/suggestions/${item.id}/decision`, "POST", {
    approve: true,
    actor_role: "user",
  });
const beforeMemory = (await call(base + "/memory")).interpretations;
const supporter = await call("auth/users", "POST", {
  username: "illustrated-needs-ci",
  display_name: "Préparation fictive",
  password,
});
const grant = `auth/users/${supporter.id}/profiles/${profile}/capabilities`;
await call(grant, "PUT", {
  capabilities: ["prepare_keyboard"],
  expected_capabilities: null,
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 900 },
  });
  const errors = [],
    creations = [];
  let modelCalls = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/illustrated-block"))
      creations.push(req);
    if (req.url().endsWith("/interpret")) modelCalls++;
  });
  await page.goto(origin + "/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(supporter.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.goto(`${origin}/accompagnement/personnes/${profile}/propositions`);
  await page
    .getByRole("button", { name: "Suivi des décisions", exact: true })
    .click();
  const card = page.getByRole("article", { name: expressions[0], exact: true });
  await card
    .getByRole("link", {
      name: "Ouvrir la préparation du clavier",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`need=${need(0).id}`));
  const preparation = page.locator(".need-touch-preparation");
  const creator = preparation.locator(".touch-preparation");
  const button = (name) => creator.getByRole("button", { name, exact: true });
  const review = (block) => page.locator(`#prepared-${block.id}`).locator("..");
  const needPath = (n) =>
    `${origin}/accompagnement/personnes/${profile}/clavier?need=${need(n).id}#keyboard-create`;
  async function prepareWord(word) {
    await expect(creator).toBeVisible();
    await expect(
      creator.getByRole("button", { name: "Photo personnelle", exact: true }),
    ).toHaveCount(0);
    await creator
      .getByLabel("Rechercher un dessin", { exact: true })
      .fill("Eau");
    await creator.getByRole("radio", { name: "Eau", exact: true }).check();
    await button("Continuer : le mot").press("Enter");
    await expect(
      creator.getByRole("heading", { name: "Écrire le mot", exact: true }),
    ).toBeFocused();
    await expect(
      creator.getByText("Préciser le sens (facultatif)", { exact: true }),
    ).toHaveCount(0);
    await creator
      .getByLabel("Texte affiché sur la touche", { exact: true })
      .fill(word);
    await button("Voir la touche à vérifier").press("Enter");
    await expect(
      creator.getByRole("heading", {
        name: "Vérifier la nouvelle touche",
        exact: true,
      }),
    ).toBeFocused();
  }
  await prepareWord("Boire ici");
  await expect(creator.locator(".touch-preparation-meaning")).toContainText(
    expressions[0],
  );
  await button("Changer l’image").click();
  await button("Continuer : le mot").click();
  await expect(
    creator.getByLabel("Texte affiché sur la touche", { exact: true }),
  ).toHaveValue("Boire ici");
  await button("Voir la touche à vérifier").click();
  assert.equal(creations.length, 0);
  await fs.mkdir(".local/need-touch", { recursive: true });
  await preparation.screenshot({
    path: ".local/need-touch/review-desktop.png",
  });

  // The server commits, but the response is lost. The existing touch must be read back.
  const route = `**/profiles/${profile}/suggestions/${need(0).id}/illustrated-block`;
  await page.route(route, async (intercepted) => {
    const response = await intercepted.fetch();
    assert(response.ok());
    await intercepted.abort("failed");
  });
  await button("Créer la touche à vérifier").press("Enter");
  await expect(
    preparation.getByRole("link", { name: "Revoir cette touche", exact: true }),
  ).toBeVisible();
  await page.unroute(route);
  assert.equal(creations.length, 1);
  let linked = (await call(base + "/blocks")).find(
    (b) => b.semantic_gap_id === need(0).id,
  );
  assert.equal(linked.status, "proposed");
  assert.equal(
    (await call(base + "/keyboard")).some((p) => p.block_id === linked.id),
    false,
  );
  await page.reload();
  await expect(
    preparation.getByRole("link", { name: "Revoir cette touche", exact: true }),
  ).toBeVisible();
  await expect(creator).toHaveCount(0);
  assert.equal(creations.length, 1);
  await preparation
    .getByRole("link", { name: "Revoir cette touche", exact: true })
    .click();
  await review(linked)
    .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
    .press("Enter");
  await expect(
    preparation.getByRole("link", {
      name: "Choisir la place de cette touche",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(
    (await call(base + "/suggestions")).find((n) => n.id === need(0).id).status,
    "resolved",
  );
  await preparation
    .getByRole("link", {
      name: "Choisir la place de cette touche",
      exact: true,
    })
    .click();
  const library = page.locator(`#touch-${linked.id}`);
  await expect(library).toBeVisible();
  await expect(
    library.getByRole("combobox", { name: "Zone", exact: true }),
  ).toBeVisible();
  await library
    .getByRole("button", { name: "Choisir la place libre 4", exact: true })
    .click();
  await library
    .getByRole("button", {
      name: "Prévisualiser le déplacement de « Boire ici »",
      exact: true,
    })
    .click();
  const preview = library.getByRole("region", {
    name: "Aperçu du déplacement",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await preview
    .getByRole("button", { name: "Confirmer le déplacement", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  const placed = (await call(base + "/keyboard")).find(
    (p) => p.block_id === linked.id,
  );
  assert.equal(placed.position, 3);
  assert.equal(placed.zone, "adaptive");
  assert.deepEqual(
    (await call(base + "/keyboard")).filter((p) => p.zone === "stable"),
    initialStable,
  );
  assert.deepEqual(
    (await call(base + "/memory")).interpretations,
    beforeMemory,
  );

  // A refusal is retained and can be reviewed explicitly, without preparing another touch.
  await page.goto(needPath(1));
  await prepareWord("Mon verre");
  await button("Créer la touche à vérifier").click();
  await expect(
    preparation.getByRole("link", { name: "Revoir cette touche", exact: true }),
  ).toBeVisible();
  linked = (await call(base + "/blocks")).find(
    (b) => b.semantic_gap_id === need(1).id,
  );
  await review(linked)
    .getByRole("button", { name: "Écarter cette touche", exact: true })
    .click();
  await expect(preparation).toContainText("Cette touche a été écartée.");
  await page.reload();
  await expect(
    preparation.getByRole("link", { name: "Revoir cette touche", exact: true }),
  ).toBeVisible();
  await expect(creator).toHaveCount(0);
  assert.equal(
    (await call(base + "/suggestions")).find((n) => n.id === need(1).id).status,
    "approved",
  );

  // A stale approval and a failed read cannot become a new touch.
  const evidenceRoute = `**/profiles/${profile}/suggestions/${need(2).id}/evidence`;
  await page.route(evidenceRoute, (intercepted) =>
    intercepted.fulfill({ status: 503, body: "{}" }),
  );
  await page.goto(needPath(2));
  await expect(preparation.locator('.error[role="alert"]')).toBeVisible();
  await expect(creator).toHaveCount(0);
  await page.unroute(evidenceRoute);
  await preparation
    .getByRole("button", { name: "Recharger le besoin", exact: true })
    .click();
  await prepareWord("Rentrer");
  for (const id of candidates[2].slice(0, 2))
    await call(base + `/interpretations/${id}/feedback`, "POST", {
      action: "reject",
      actor_role: "user",
    });
  await button("Créer la touche à vérifier").click();
  await expect(preparation).toContainText(
    "Ce besoin n’est pas disponible pour une nouvelle touche",
  );
  assert.equal(
    (await call(base + "/blocks")).some(
      (b) => b.semantic_gap_id === need(2).id,
    ),
    false,
  );
  assert.equal(creations.length, 3); // One lost response, one success, one stale write; no replay.

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(needPath(1));
  await expect(
    preparation.getByRole("link", { name: "Revoir cette touche", exact: true }),
  ).toBeVisible();
  await preparation.screenshot({
    path: ".local/need-touch/refused-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.goto(
    `${origin}/accompagnement/personnes/${profile}/clavier?need=invalid`,
  );
  await expect(preparation.locator('.error[role="alert"]')).toBeVisible();
  await expect(creator).toHaveCount(0);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Accepted need → drawing/word → explicit review → chosen placement verified; lost response, refusal, stale evidence, read outage and mobile recovery preserved.",
  );
} finally {
  await browser.close();
  await admin.dispose();
}
