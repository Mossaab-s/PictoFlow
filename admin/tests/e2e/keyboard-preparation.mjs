import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3132";
const password = "Synthetic capability CI passphrase";
const admin = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const logged = await admin.post("/api/pictoflow/auth/login", {
  data: { username: "capability-ci-admin", password },
});
assert(logged.ok());
const csrf = (await logged.json()).csrf_token;
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
  await call("profiles", "POST", { display_name: "Préparation guidée fictive" })
).id;
const base = `profiles/${profile}`;
const anchor = await call(base + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Maman",
  pictogram_key: "mother",
  actor_role: "user",
});
await call(base + `/blocks/${anchor.id}/feedback`, "POST", {
  action: "confirm",
  confirm_representation: true,
  actor_role: "user",
});
await call(base + `/keyboard/${anchor.id}`, "PUT", {
  zone: "stable",
  position: 0,
  actor_role: "user",
});
const beforePositions = await call(base + "/keyboard");
const supporter = await call("auth/users", "POST", {
  username: "guided-keyboard-ci",
  display_name: "Préparation fictive",
  password,
});
await call(
  `auth/users/${supporter.id}/profiles/${profile}/capabilities`,
  "PUT",
  {
    capabilities: ["prepare_keyboard"],
    expected_capabilities: null,
  },
);
const secondProfile = (
  await call("profiles", "POST", { display_name: "Autre clavier fictif" })
).id;
await call(
  `auth/users/${supporter.id}/profiles/${secondProfile}/capabilities`,
  "PUT",
  {
    capabilities: ["prepare_keyboard"],
    expected_capabilities: null,
  },
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 900 },
  });
  // This scenario exercises the detailed tools available from Options.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("pictoflow:communication-view", "tools");
    } catch {
      /* Optional UI preference. */
    }
  });
  const errors = [],
    writes = [];
  let modelCalls = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (
      req.url().includes(`/profiles/${profile}/`) &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
    )
      writes.push(req);
    if (req.url().endsWith("/interpret")) modelCalls++;
  });
  await page.goto(origin + "/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(supporter.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.goto(`${origin}/accompagnement/personnes/${profile}/clavier`);
  const creator = page.locator(".touch-creator");
  const button = (name) => creator.getByRole("button", { name, exact: true });
  const word = creator.getByLabel("Texte affiché sur la touche", {
    exact: true,
  });
  async function image(name) {
    await creator
      .getByLabel("Rechercher un dessin", { exact: true })
      .fill(name);
    await creator.getByRole("radio", { name, exact: true }).check();
  }
  async function nextWord() {
    await button("Continuer : le mot").press("Enter");
    await expect(
      creator.getByRole("heading", { name: "Écrire le mot", exact: true }),
    ).toBeFocused();
  }
  async function preview() {
    await button("Voir la touche à vérifier").click();
    await expect(
      creator.getByRole("heading", {
        name: "Vérifier la nouvelle touche",
        exact: true,
      }),
    ).toBeFocused();
  }
  const card = (label) =>
    page.locator(".block-list > section.panel").filter({
      has: page.getByRole("heading", { name: label, exact: true }),
    });
  async function uncertainCreation(endpoint, label) {
    let committed;
    const bodies = [];
    const routeURL = `**/api/pictoflow/${base}/${endpoint}`;
    await page.route(routeURL, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert(response.ok());
      committed = await response.json();
      await route.abort("failed");
    });
    await button("Créer la touche à vérifier").click();
    await expect(card(label)).toBeVisible();
    await expect(button("Créer la touche à vérifier")).toBeEnabled();
    assert.equal(committed.status, "proposed");
    assert(
      !(await call(base + "/keyboard")).some(
        (p) => p.block_id === committed.id,
      ),
    );
    assert.equal(await word.count(), 0); // The local review step survives the failed response.
    await page.unroute(routeURL);
    const [retried] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith(`/${endpoint}`),
      ),
      button("Créer la touche à vérifier").click(),
    ]);
    assert.equal(retried.postDataJSON().request_id, bodies[0].request_id);
    await expect(page.locator(`#prepared-${committed.id}`)).toBeFocused();
    assert.equal(
      (await call(base + "/blocks")).filter((b) => b.label === label).length,
      1,
    );
    return committed;
  }
  await expect(button("Continuer : le mot")).toBeDisabled();
  assert.equal(await word.count(), 0);
  await image("Eau");
  await image("Boire");
  await nextWord();
  assert.equal(await word.inputValue(), "Boire");
  await word.fill("Mon verre");
  const meaningInput = creator.getByLabel(
    "Ce que cette touche signifie pour moi, facultatif",
  );
  await expect(meaningInput).toBeHidden();
  await creator
    .getByText("Préciser le sens (facultatif)", { exact: true })
    .click();
  await meaningInput.fill("Boire dans mon verre bleu");
  await preview();
  await expect(creator.locator(".touch-word")).toHaveText("Mon verre");
  await expect(creator.locator(".touch-preparation-meaning")).toContainText(
    "Boire dans mon verre bleu",
  );
  await button("Changer l’image").click();
  await image("Eau");
  await nextWord();
  assert.equal(await word.inputValue(), "Mon verre");
  await preview();
  assert.equal(writes.length, 0);
  await fs.mkdir(".local/keyboard-preparation", { recursive: true });
  await creator.screenshot({
    path: ".local/keyboard-preparation/review-desktop.png",
  });
  const first = await uncertainCreation("blocks/personal", "Mon verre");
  await card("Mon verre")
    .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
    .click();
  await page.locator(`#touch-${first.id}`).waitFor();
  assert.deepEqual(
    (await call(base + "/keyboard")).filter((p) => p.block_id === anchor.id),
    beforePositions,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const photo = await page.screenshot({
    clip: { x: 0, y: 0, width: 32, height: 32 },
  });
  const beforePhoto = writes.length;
  await button("Photo personnelle").click();
  await expect(button("Continuer : le mot")).toBeDisabled();
  const upload = creator.getByLabel("Choisir une photo personnelle", {
    exact: true,
  });
  await upload.setInputFiles({
    name: "fixture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(button("Continuer : le mot")).toBeDisabled();
  await upload.setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await nextWord();
  await word.fill("Photo de mon verre");
  await creator
    .getByText("Préciser le sens (facultatif)", { exact: true })
    .click();
  await creator
    .getByLabel("Sens existant", { exact: true })
    .selectOption(first.concept_id);
  assert.equal(await word.inputValue(), "Photo de mon verre");
  await preview();
  await expect(creator.locator(".touch-word")).toHaveText("Photo de mon verre");
  await expect(creator.locator("img.touch-photo")).toBeVisible();
  await expect
    .poll(() =>
      creator
        .locator("img.touch-photo")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  assert.equal(writes.length, beforePhoto);
  await creator.screenshot({
    path: ".local/keyboard-preparation/photo-review-mobile.png",
  });
  const second = await uncertainCreation("blocks/photo", "Photo de mon verre");
  assert.equal(second.concept_id, first.concept_id);
  await card("Photo de mon verre")
    .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
    .click();
  await page.locator(`#touch-${second.id}`).waitFor();

  const beforeReuse = writes.length;
  await image("Eau");
  await nextWord();
  await word.fill("Autre dessin de mon verre");
  await creator
    .getByText("Préciser le sens (facultatif)", { exact: true })
    .click();
  await creator
    .getByLabel("Sens existant", { exact: true })
    .selectOption(first.concept_id);
  await preview();
  assert.equal(writes.length, beforeReuse);
  const third = await uncertainCreation("blocks", "Autre dessin de mon verre");
  assert.equal(third.concept_id, first.concept_id);
  await card(third.label)
    .getByRole("button", { name: "Écarter cette touche", exact: true })
    .click();
  await expect(card(third.label)).toHaveCount(0);
  assert(
    !(await call(base + "/keyboard")).some((p) => p.block_id === third.id),
  );
  assert.deepEqual(
    (await call(base + "/keyboard")).filter((p) => p.block_id === anchor.id),
    beforePositions,
  );
  assert.equal((await call(base + "/concepts")).length, 2);
  assert.deepEqual(await call(base + "/sequences"), []);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  const beforeSwitch = writes.length;
  await image("Eau");
  await nextWord();
  await word.fill("Mot privé du premier profil");
  await page.goto(
    `${origin}/accompagnement/personnes/${secondProfile}/clavier`,
  );
  await expect(
    creator.getByRole("heading", { name: "Choisir l’image", exact: true }),
  ).toBeVisible();
  assert.equal(await word.count(), 0);
  await image("Eau");
  await nextWord();
  assert.equal(await word.inputValue(), "Eau");
  assert.deepEqual(await call(`profiles/${secondProfile}/blocks`), []);
  assert.equal(writes.length, beforeSwitch);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 320, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  console.log(
    "Authenticated three-step touch preparation verified: local back/edit, custom wording and meaning, photo and existing meaning, uncertain writes without duplicates, explicit validation/refusal, stable anchors and no AI/memory writes.",
  );
} finally {
  await browser.close();
  await admin.dispose();
}
