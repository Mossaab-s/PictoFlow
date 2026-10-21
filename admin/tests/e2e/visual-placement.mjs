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
  await call("profiles", "POST", { display_name: "Placement visuel fictif" })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autres repères fictifs" })
).id;
const base = `profiles/${profile}`;
const activities = await call(base + "/keyboard-groups", "POST", {
  label: "Activités",
  actor_role: "user",
});
async function touch(p, label, key, zone, position, group_id = null) {
  const prefix = `profiles/${p}`;
  const block = await call(prefix + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: key,
    actor_role: "user",
  });
  await call(prefix + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  await call(prefix + `/keyboard/${block.id}`, "PUT", {
    zone,
    position,
    group_id,
    actor_role: "user",
  });
  return block;
}
const water = await touch(profile, "Mon verre", "water", "personal", 2);
const mother = await touch(profile, "Maman", "mother", "stable", 0);
const drink = await touch(profile, "Boire", "drink", "personal", 6);
await touch(profile, "Livre", "book", "personal", 4, activities.id);
const other = await touch(second, "Autre profil", "toy", "personal", 0);
const supporter = await call("auth/users", "POST", {
  username: "visual-placement-ci",
  display_name: "Placement fictif",
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
  "memory",
  "sequences",
  "audit",
])
  before[resource] = await call(base + "/" + resource);
const otherBefore = await call(`profiles/${second}/keyboard`);
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Exercise the detailed tools available from Options.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("pictoflow:communication-view", "tools");
    } catch {}
  });
  page.setDefaultTimeout(15000);
  const writes = [],
    errors = [];
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
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `pictoflow:display:${id}`,
        JSON.stringify({ version: 1, size: "extra-large" }),
      ),
    profile,
  );
  await page.goto(`${origin}/accompagnement/personnes/${profile}/clavier`);
  const card = page.locator(`#touch-${water.id}`);
  await card
    .getByLabel("Modifier la touche « Mon verre »", { exact: true })
    .click();
  const picker = card.getByRole("region", {
    name: "Choisir une place visuellement",
    exact: true,
  });
  const slot = card.getByLabel("Place", { exact: true });
  const zone = card.getByRole("combobox", { name: "Zone", exact: true });
  const destination = card.getByRole("combobox", { name: "Page", exact: true });
  const button = (name) => picker.getByRole("button", { name, exact: true });
  const choose = (n) => button(`Choisir la place libre ${n}`);
  await expect(picker.locator(".placement-slot")).toHaveCount(4);
  await expect(button("Place 3, place actuelle de Mon verre")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await choose(2).press("Enter");
  await expect(slot).toHaveValue("2");
  await expect(choose(2)).toHaveAttribute("aria-pressed", "true");
  await button("Places suivantes").click();
  await expect(button("Place 7 occupée par Boire")).toBeDisabled();
  await expect(slot).toHaveValue("2");
  await expect(picker).toContainText(
    "Destination choisie : Accueil · place 2.",
  );
  await button("Revenir à la place choisie").click();
  await expect(choose(2)).toHaveAttribute("aria-pressed", "true");
  await expect(choose(2)).toBeFocused();
  await slot.fill("1000");
  await expect(choose(1000)).toHaveAttribute("aria-pressed", "true");
  await expect(button("Places suivantes")).toBeDisabled();
  await expect(picker.locator(".placement-slot")).toHaveCount(4);
  await slot.fill("2");
  await zone.selectOption("stable");
  await expect(picker.locator(".placement-slot")).toHaveCount(12);
  await expect(picker).toContainText("Toutes les pages · Repères stables");
  await expect(destination).toBeDisabled();
  await expect(button("Place 1 occupée par Maman")).toBeDisabled();
  await choose(4).click();
  await expect(slot).toHaveValue("4");
  await zone.selectOption("personal");
  await expect(picker.locator(".placement-slot")).toHaveCount(4);
  await destination.selectOption(activities.id);
  await button("Places suivantes").click();
  await expect(button("Place 5 occupée par Livre")).toBeDisabled();
  await fs.mkdir(".local/visual-placement", { recursive: true });
  await picker.screenshot({
    path: ".local/visual-placement/neighbours-desktop.png",
  });
  await button("Revenir à la place choisie").click();
  await choose(2).click();
  assert.equal(writes.length, 0);
  assert.deepEqual(await call(base + "/keyboard"), before.keyboard);
  assert.deepEqual(await call(base + "/audit"), before.audit);
  await fs.mkdir(".local/visual-placement", { recursive: true });
  await picker.screenshot({
    path: ".local/visual-placement/selected-desktop.png",
  });

  // A second preparer fills the selected case after the local grid was read.
  const otherPreview = await call(
    base + `/keyboard/${drink.id}/move-preview`,
    "POST",
    {
      position: 1,
      destination_group_id: activities.id,
    },
  );
  await call(base + `/keyboard/${drink.id}/move`, "POST", {
    position: 1,
    destination_group_id: activities.id,
    preview_token: otherPreview.preview_token,
    actor_role: "user",
  });
  const concurrent = await call(base + "/keyboard");
  const concurrentAudit = await call(base + "/audit");
  const prepare = card.getByRole("button", {
    name: "Prévisualiser le déplacement de « Mon verre »",
    exact: true,
  });
  await prepare.click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "le clavier a changé",
  );
  await expect(button("Place 2 occupée par Boire")).toBeDisabled();
  await expect(slot).toHaveValue("2");
  await expect(picker).toContainText(
    "Cette place est occupée. Choisissez une case libre.",
  );
  assert.deepEqual(await call(base + "/keyboard"), concurrent);
  await choose(3).press("Enter");
  await prepare.click();
  const preview = card.getByRole("region", {
    name: "Aperçu du déplacement",
    exact: true,
  });
  await expect(preview).toContainText("Activités · place 3");
  assert.deepEqual(await call(base + "/keyboard"), concurrent);
  await preview
    .getByRole("button", { name: "Annuler cet aperçu", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  assert.deepEqual(await call(base + "/audit"), concurrentAudit);
  await prepare.click();
  await expect(preview).toBeVisible();
  await choose(4).click();
  await expect(preview).toHaveCount(0); // Editing the local destination clears its old approval target.
  assert.deepEqual(await call(base + "/keyboard"), concurrent);
  await choose(3).click();
  await prepare.click();
  await preview
    .getByRole("button", { name: "Confirmer le déplacement", exact: true })
    .click();
  await expect(card.locator(".touch-library-location")).toHaveText(
    "Activités · Mes touches · place 3",
  );
  const after = await call(base + "/keyboard");
  assert.equal(
    after.find((p) => p.block_id === water.id).group_id,
    activities.id,
  );
  assert.equal(after.find((p) => p.block_id === water.id).position, 2);
  assert.deepEqual(
    after.filter((p) => p.block_id !== water.id),
    concurrent.filter((p) => p.block_id !== water.id),
  );
  assert.deepEqual(
    after.filter((p) => p.block_id === mother.id),
    before.keyboard.filter((p) => p.block_id === mother.id),
  );
  for (const resource of [
    "blocks",
    "concepts",
    "representations",
    "memory",
    "sequences",
  ])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  await page.setViewportSize({ width: 320, height: 844 });
  await picker.screenshot({
    path: ".local/visual-placement/selected-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await zone.selectOption("stable");
  await expect(picker.locator(".placement-slot")).toHaveCount(12);
  await picker.screenshot({
    path: ".local/visual-placement/stable-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const beforeSwitch = writes.length;
  await page.goto(`${origin}/accompagnement/personnes/${second}/clavier`);
  const otherCard = page.locator(`#touch-${other.id}`);
  await otherCard
    .getByLabel("Modifier la touche « Autre profil »", { exact: true })
    .click();
  const otherPicker = otherCard.getByRole("region", {
    name: "Choisir une place visuellement",
    exact: true,
  });
  await expect(otherPicker.locator(".placement-slot")).toHaveCount(12);
  await expect(otherCard.getByLabel("Place", { exact: true })).toHaveValue("1");
  await expect(otherPicker.locator(".touch-word")).toHaveText(["Autre profil"]);
  assert.deepEqual(await call(`profiles/${second}/keyboard`), otherBefore);
  assert.equal(writes.length, beforeSwitch);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated visual placement verified: profile display sizes, global anchors, scoped pictogram neighbours, free-case keyboard selection, range browsing without writes, numeric boundaries, concurrent occupancy, preview/cancel/confirm, preserved gaps and memory, profile reset and mobile layout.",
  );
} catch (error) {
  if (page) {
    await fs.mkdir(".local/visual-placement", { recursive: true });
    await page.screenshot({
      path: ".local/visual-placement/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
