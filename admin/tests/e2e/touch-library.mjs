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
  await call("profiles", "POST", { display_name: "Rangement fictif" })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre rangement fictif" })
).id;
const base = `profiles/${profile}`;
const activities = await call(base + "/keyboard-groups", "POST", {
  label: "Activités",
  actor_role: "user",
});
const people = await call(base + "/keyboard-groups", "POST", {
  label: "Personnes",
  actor_role: "user",
});
async function touch(
  p,
  label,
  drawing,
  meaning,
  zone,
  position,
  group_id = null,
) {
  const prefix = `profiles/${p}`;
  const block = await call(prefix + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    meaning,
    pictogram_key: drawing,
    actor_role: "user",
  });
  await call(prefix + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    confirm_representation: true,
    actor_role: "user",
  });
  await call(prefix + `/keyboard/${block.id}`, "PUT", {
    zone,
    position,
    group_id,
    actor_role: "user",
  });
  return block;
}
const water = await touch(
  profile,
  "Mon verre",
  "water",
  "L’eau fraîche pour boire",
  "personal",
  2,
);
const mother = await touch(profile, "Maman", "mother", "Maman", "stable", 0);
await touch(profile, "Boire", "drink", "Boire", "personal", 6);
await touch(
  profile,
  "Livre",
  "book",
  "Lire ensemble",
  "personal",
  4,
  activities.id,
);
await touch(
  profile,
  "Écouter",
  "music",
  "Mon morceau préféré",
  "personal",
  7,
  activities.id,
);
await touch(profile, "Papa", "father", "Papa", "personal", 1, people.id);
await call(base + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Pas encore validée",
  pictogram_key: "water",
  actor_role: "user",
});
const other = await touch(
  second,
  "Autre profil",
  "water",
  "Un autre sens",
  "personal",
  0,
);
// Seed two explicitly accepted messages for the existing usage-to-placement link.
for (let i = 0; i < 2; i++) {
  const sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  await call(base + `/sequences/${sequence.id}/selection`, "POST", {
    action: "append",
    block_id: water.id,
  });
  await call(base + `/sequences/${sequence.id}/selection`, "POST", {
    action: "complete",
  });
  const interpretation = (
    await call(base + `/sequences/${sequence.id}/interpret`, "POST", {})
  ).candidates[0];
  await call(base + `/interpretations/${interpretation.id}/feedback`, "POST", {
    action: "correct",
    actor_role: "user",
    corrected_value: "Je voudrais boire dans mon verre.",
  });
}
const supporter = await call("auth/users", "POST", {
  username: "touch-library-ci",
  display_name: "Rangement fictif",
  password,
});
for (const p of [profile, second])
  await call(`auth/users/${supporter.id}/profiles/${p}/capabilities`, "PUT", {
    capabilities: ["prepare_keyboard"],
    expected_capabilities: null,
  });
const before = {};
for (const resource of [
  "keyboard",
  "blocks",
  "concepts",
  "representations",
  "sequences",
  "memory",
  "audit",
])
  before[resource] = await call(base + "/" + resource);
const otherBefore = await call(`profiles/${second}/keyboard`);
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(15000);
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
  const library = page.getByRole("region", {
    name: "Mes touches à modifier",
    exact: true,
  });
  const search = library.getByLabel("Rechercher une touche ou son sens", {
    exact: true,
  });
  const filter = library.getByLabel("Afficher les touches", { exact: true });
  const card = page.locator(`#touch-${water.id}`);
  const summary = card.getByLabel("Modifier la touche « Mon verre »", {
    exact: true,
  });
  const reset = () =>
    library
      .getByRole("button", { name: "Afficher toutes les touches", exact: true })
      .click();
  await expect(library.getByRole("status")).toHaveText("6 sur 6 touches");
  await page
    .getByRole("link", { name: "Modifier une touche", exact: true })
    .click();
  await expect(library).toBeFocused();
  assert.equal(
    await library.getByRole("combobox", { name: "Zone", exact: true }).count(),
    0,
  );
  await expect(card.locator(".touch-library-location")).toHaveText(
    "Accueil · Mes touches · place 3",
  );
  await expect(
    page.locator(`#touch-${mother.id} .touch-library-location`),
  ).toHaveText("Toutes les pages · Repères stables · place 1");
  await search.fill(" EAU FRAICHE ");
  await expect(library.getByRole("status")).toHaveText("1 sur 6 touches");
  await expect(summary).toBeVisible();
  await filter.selectOption(`group:${activities.id}`);
  await expect(
    library.getByText("Aucune touche ne correspond.", { exact: false }),
  ).toBeVisible();
  await reset();
  await expect(search).toBeFocused();
  for (const [value, count] of [
    ["home", 2],
    ["stable", 1],
    [`group:${activities.id}`, 2],
    [`group:${people.id}`, 1],
  ]) {
    await filter.selectOption(value);
    await expect(library.getByRole("status")).toHaveText(
      `${count} sur 6 touches`,
    );
  }
  await reset();
  await search.fill("ecouter");
  await expect(library.getByRole("status")).toHaveText("1 sur 6 touches");
  await expect(
    library.getByLabel("Modifier la touche « Écouter »", { exact: true }),
  ).toBeVisible();
  await search.fill("secret introuvable");
  await expect(library.getByRole("status")).toHaveText("0 sur 6 touches");
  await reset();
  await summary.press("Enter");
  const textDetails = card.getByText("Modifier le texte de « Mon verre »", {
    exact: true,
  });
  await textDetails.click();
  const text = card.getByLabel("Texte de la touche", { exact: true });
  await text.fill("Brouillon non enregistré");
  await filter.selectOption(`group:${people.id}`);
  await expect(card).toBeHidden();
  await filter.selectOption("home");
  await expect(text).toHaveValue("Brouillon non enregistré");
  await summary.press("Enter");
  await summary.press("Enter");
  await expect(text).toHaveValue("Brouillon non enregistré");
  const usages = page.getByRole("region", {
    name: "Touches souvent choisies",
    exact: true,
  });
  await usages
    .getByRole("button", { name: "Examiner mes usages acceptés", exact: true })
    .click();
  const link = usages.getByRole("link", {
    name: "Choisir la place de « Mon verre »",
    exact: true,
  });
  // Repeat the same fragment: it must work even when no hashchange is emitted.
  for (let i = 0; i < 2; i++) {
    await filter.selectOption(`group:${people.id}`);
    await link.click();
    await expect(card).toBeFocused();
    await expect(filter).toHaveValue("all");
    await expect(text).toHaveValue("Brouillon non enregistré");
    if (!i) await summary.click();
  }
  assert.equal(writes.length, 0);
  assert.deepEqual(await call(base + "/audit"), before.audit);
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  await fs.mkdir(".local/touch-library", { recursive: true });
  await summary.click();
  await library.screenshot({
    path: ".local/touch-library/library-desktop.png",
  });
  await summary.click();
  const destination = card.getByRole("combobox", { name: "Page", exact: true });
  const slot = card.getByLabel("Place", { exact: true });
  const prepare = card.getByRole("button", {
    name: "Prévisualiser le déplacement de « Mon verre »",
    exact: true,
  });
  await destination.selectOption(activities.id);
  await slot.fill("8"); // Écouter occupies this same personal-zone place.
  await prepare.click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "le clavier a changé",
  );
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  await slot.fill("9");
  await prepare.click();
  const preview = card.getByRole("region", {
    name: "Aperçu du déplacement",
    exact: true,
  });
  await expect(preview).toBeVisible();
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  await preview
    .getByRole("button", { name: "Annuler cet aperçu", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  await prepare.click();
  // An actual concurrent page rename invalidates the server's preview.
  await call(base + `/keyboard-groups/${activities.id}`, "PATCH", {
    label: "Mes activités",
    expected_label: "Activités",
    actor_role: "user",
  });
  await preview
    .getByRole("button", { name: "Confirmer le déplacement", exact: true })
    .click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "le clavier a changé",
  );
  await expect(preview).toHaveCount(0);
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  await filter.selectOption("home");
  await prepare.click();
  await expect(preview).toContainText("Mes activités · place 9");
  await preview
    .getByRole("button", { name: "Confirmer le déplacement", exact: true })
    .click();
  await expect(card).toBeHidden(); // Moving a touch updates the current Home filter.
  await expect(search).toBeFocused();
  await expect(library.getByRole("status")).toHaveText("1 sur 6 touches");
  const after = await call(base + "/keyboard");
  assert.equal(
    after.find((p) => p.block_id === water.id).group_id,
    activities.id,
  );
  assert.equal(after.find((p) => p.block_id === water.id).position, 8);
  assert.deepEqual(
    after.filter((p) => p.block_id !== water.id),
    before.keyboard.filter((p) => p.block_id !== water.id),
  );
  for (const resource of [
    "blocks",
    "concepts",
    "representations",
    "sequences",
    "memory",
  ])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  await reset();
  await expect(card.locator(".touch-library-location")).toHaveText(
    "Mes activités · Mes touches · place 9",
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await summary.click();
  await library.screenshot({ path: ".local/touch-library/library-mobile.png" });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await summary.click();
  await card.screenshot({ path: ".local/touch-library/settings-mobile.png" });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await search.fill("Mon verre");
  await page.goto(`${origin}/accompagnement/personnes/${second}/clavier`);
  await expect(library.getByRole("status")).toHaveText("1 sur 1 touches");
  await expect(search).toHaveValue("");
  await expect(filter).toHaveValue("all");
  await expect(page.locator(`#touch-${water.id}`)).toHaveCount(0);
  await page
    .getByLabel("Modifier la touche « Autre profil »", { exact: true })
    .click();
  await page
    .getByText("Modifier le texte de « Autre profil »", { exact: true })
    .click();
  await expect(
    page
      .locator(`#touch-${other.id}`)
      .getByLabel("Texte de la touche", { exact: true }),
  ).toHaveValue("Autre profil");
  assert.deepEqual(await call(`profiles/${second}/keyboard`), otherBefore);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated touch library verified: scoped word/meaning search, page filters, retained local drafts, repeated direct links, keyboard activation, occupied/stale previews, explicit cancel/confirm, stable anchors, profile reset and no AI or memory changes.",
  );
} catch (error) {
  if (page) {
    await fs.mkdir(".local/touch-library", { recursive: true });
    await page.screenshot({
      path: ".local/touch-library/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
