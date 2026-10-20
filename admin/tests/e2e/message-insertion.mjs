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
  await call("profiles", "POST", {
    display_name: "Insertion personnelle fictive",
  })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre insertion fictive" })
).id;
const base = `profiles/${profile}`;
async function touch(p, label, drawing, position) {
  const prefix = `profiles/${p}`;
  const block = await call(prefix + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: drawing,
    actor_role: "user",
  });
  await call(prefix + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  await call(prefix + `/keyboard/${block.id}`, "PUT", {
    zone: "personal",
    position,
    actor_role: "user",
  });
  return block;
}
const mother = await touch(profile, "Maman", "mother", 0);
const water = await touch(profile, "Eau", "water", 1);
const book = await touch(profile, "Livre", "book", 2);
await touch(second, "Papa", "father", 0);
const outings = await call(base + "/keyboard-groups", "POST", {
  label: "Sorties",
  actor_role: "user",
});
const outsideWater = await touch(profile, "Eau", "water", 3);
await call(base + `/keyboard/${outsideWater.id}`, "PUT", {
  zone: "personal",
  position: 0,
  group_id: outings.id,
  actor_role: "user",
});
// An independently accepted phrase must survive all draft edits below.
const reference = await call(base + "/sequences", "POST", {
  session_id: crypto.randomUUID(),
});
await call(base + `/sequences/${reference.id}/selection`, "POST", {
  action: "append",
  block_id: water.id,
});
await call(base + `/sequences/${reference.id}/selection`, "POST", {
  action: "complete",
});
const proposal = await call(
  base + `/sequences/${reference.id}/interpret`,
  "POST",
  {},
);
await call(
  base + `/interpretations/${proposal.candidates[0].id}/feedback`,
  "POST",
  { action: "confirm", actor_role: "user" },
);
const account = await call("auth/users", "POST", {
  username: "message-insertion-ci",
  display_name: "Communication fictive",
  password,
});
for (const id of [profile, second])
  await call(`auth/users/${account.id}/profiles/${id}/capabilities`, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: null,
  });
const before = {};
for (const resource of [
  "memory",
  "keyboard",
  "blocks",
  "concepts",
  "representations",
])
  before[resource] = await call(base + "/" + resource);
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [
          {
            voiceURI: "synthetic-fr",
            name: "Synthetic French",
            lang: "fr-FR",
            localService: true,
            default: true,
          },
        ],
        speak(utterance) {
          window.__spoken.push(utterance.text);
          utterance.onstart?.();
        },
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
      },
    });
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
  await fs.mkdir(".local/message-insertion", { recursive: true });
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(account.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.goto(`${origin}/communication/${profile}`);
  const keyboard = page.getByRole("region", {
    name: "Mon clavier de communication",
    exact: true,
  });
  const message = page.getByRole("region", {
    name: "Message en cours",
    exact: true,
  });
  const words = message.locator(".message-touch .touch-word");
  const opener = message.getByRole("button", {
    name: "Corriger une touche",
    exact: true,
  });
  const finish = message.getByRole("button", {
    name: "Finir la correction",
    exact: true,
  });
  const mode = message.getByRole("button", {
    name: "Insérer une touche",
    exact: true,
  });
  const group = message.getByRole("group", {
    name: "Touches à corriger",
    exact: true,
  });
  const occurrence = (word, ordinal, total) =>
    group.getByRole("button", {
      name: `Insérer près de « ${word} », touche ${ordinal} sur ${total}`,
      exact: true,
    });
  const dialog = page.getByRole("dialog", {
    name: "Insérer une touche",
    exact: true,
  });
  const picker = dialog.getByRole("region", {
    name: "Clavier d’insertion",
    exact: true,
  });
  const keep = dialog.getByRole("button", {
    name: "Garder le message actuel",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirmer l’ajout",
    exact: true,
  });
  const another = dialog.getByRole("button", {
    name: "Choisir une autre touche",
    exact: true,
  });
  const heading = dialog.getByRole("heading", {
    name: "Vérifier l’ajout",
    exact: true,
  });
  const position = dialog.getByLabel("Ajouter la touche", { exact: true });
  const preview = dialog.getByRole("list", {
    name: "Message proposé",
    exact: true,
  });
  const previewWords = preview.locator(".touch-word");
  async function choose(word, ordinal, total, added, after = false) {
    await occurrence(word, ordinal, total).click();
    await expect(keep).toBeFocused();
    if (added !== undefined) {
      await picker.getByRole("button", { name: added, exact: true }).click();
      await expect(heading).toBeFocused();
      if (after) await position.selectOption("after");
    }
  }
  async function insertMode() {
    await opener.click();
    await mode.click();
  }
  await page
    .getByRole("button", { name: "Plus d’options", exact: true })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Enregistrer les intervalles entre mes prochaines touches",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Revenir au clavier", exact: true })
    .click();
  await expect(opener).toHaveCount(0);
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith(`/${base}/sequences`),
  );
  for (const [index, label] of ["Maman", "Eau", "Livre", "Eau"].entries()) {
    const key = keyboard.getByRole("button", { name: label, exact: true });
    if (index % 2 === 0) {
      await key.focus();
      await key.press("Enter");
    } else await key.click();
    await expect(words).toHaveCount(index + 1);
    await expect(key).toBeEnabled();
  }
  const path = base + `/sequences/${(await (await created).json()).id}`;
  const selectionURL = `**/api/pictoflow/${path}/selection`;
  const rhythm = await call(path + "/rhythm");
  assert.equal(rhythm.intervals.length, 3);
  const untouched = writes.length;
  const auditBefore = await call(base + "/audit");
  await insertMode();
  await choose("Eau", 4, 4, "Eau");
  await expect(confirm).toBeEnabled(); // Repeating the exact same touch is meaningful.
  await expect(previewWords).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Eau",
  ]);
  await another.click();
  await expect(
    picker.getByRole("button", { name: "Eau", exact: true }),
  ).toBeFocused();
  await picker
    .getByRole("button", { name: "Retrouver une touche", exact: true })
    .click();
  const input = picker.getByLabel("Chercher le mot de ma touche", {
    exact: true,
  });
  await input.fill("Maman");
  const result = picker.locator(".touch-search-results").getByRole("button", {
    name: "Choisir « Maman » pour l’insertion",
    exact: true,
  });
  await result.press("Enter");
  await expect(heading).toBeFocused();
  await another.click();
  await expect(result).toBeFocused();
  await expect(input).toHaveValue("Maman");
  await result.click();
  await position.selectOption("after");
  await expect(previewWords).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
  ]);
  await keep.click();
  await expect(occurrence("Eau", 4, 4)).toBeFocused();
  assert.equal(writes.length, untouched);
  assert.deepEqual(await call(base + "/audit"), auditBefore);
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await choose("Eau", 4, 4, "Maman");
  await expect(previewWords).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Maman",
    "Eau",
  ]);
  await expect(preview.locator("svg.pictogram")).toHaveCount(5);
  await expect(preview.locator('[aria-current="step"]')).toContainText(
    "Place 4 · ajoutée",
  );
  await dialog.screenshot({
    path: ".local/message-insertion/review-desktop.png",
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let pending = 0;
  await page.route(selectionURL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    pending++;
    await held;
    await route.continue();
  });
  await confirm.press("Enter");
  await expect.poll(() => pending).toBe(1);
  await expect(confirm).toBeDisabled();
  await expect(keep).toBeDisabled();
  await expect(position).toBeDisabled();
  await expect(another).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Ajout en cours…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Maman", "Eau"]);
  await expect(occurrence("Maman", 4, 5)).toBeFocused();
  assert.equal(pending, 1);
  assert.deepEqual((await call(path)).block_ids, [
    mother.id,
    water.id,
    book.id,
    mother.id,
    water.id,
  ]);
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await page.unroute(selectionURL);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Maman Eau Livre Maman Eau",
  ]);
  await choose("Eau", 2, 5, "Maman");
  await keep.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);
  await keyboard.getByRole("button", { name: "Livre", exact: true }).click();
  await expect(words).toHaveCount(6);
  assert.equal(
    writes
      .filter((req) => req.postDataJSON()?.action === "append")
      .at(-1)
      .postDataJSON().observation.interval_ms,
    null,
  );
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await choose("Livre", 3, 6, "Eau", true);
  let uncertain = 0;
  await page.route(selectionURL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    uncertain++;
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await confirm.click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
    "Eau",
    "Livre",
  ]);
  await expect(occurrence("Eau", 4, 7)).toBeFocused();
  assert.equal(uncertain, 1);
  await page.unroute(selectionURL);
  await choose("Eau", 2, 7, "Maman");
  await call(path + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${path}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "Votre ajout n’a pas été appliqué",
  );
  await expect(words).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
    "Eau",
  ]);
  await expect(occurrence("Eau", 2, 6)).toBeFocused();
  await choose("Maman", 1, 6, "Livre");
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await keep.click();
  await finish.click();
  await expect(opener).toBeDisabled();
  await page.context().setOffline(false);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
  await insertMode();
  await choose("Maman", 1, 6, "Livre");
  const beforeSwitch = writes.length;
  await page.goto(`${origin}/communication/${second}`);
  await expect(
    page.getByRole("button", { name: "Papa", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(6);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  assert.equal(writes.length, beforeSwitch);
  await insertMode();
  await choose("Maman", 1, 6, "Livre");
  await page.reload();
  await expect(words).toHaveCount(6);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  await insertMode();
  await choose("Maman", 1, 6, "Livre");
  await confirm.click();
  await expect(words).toHaveText([
    "Livre",
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
    "Eau",
  ]);
  await expect(occurrence("Livre", 1, 7)).toBeFocused();
  // A different personal page supplies a distinct touch with the same displayed word.
  await choose("Eau", 7, 7);
  await picker.getByRole("button", { name: "Sorties", exact: true }).click();
  await picker.getByRole("button", { name: "Eau", exact: true }).click();
  await position.selectOption("after");
  await expect(dialog.locator(".insertion-choice")).toContainText("Sorties");
  await confirm.click();
  await expect(words).toHaveCount(8);
  assert.equal((await call(path)).block_ids.at(-1), outsideWater.id);
  await expect(
    keyboard.getByRole("button", { name: "Accueil", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await choose("Livre", 1, 8, "Maman");
  for (let i = 0; i < 7; i++)
    await call(path + "/selection", "POST", { action: "undo" });
  await confirm.click();
  await expect(words).toHaveText(["Livre"]);
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await choose("Livre", 1, 1, "Livre", true);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(words).toHaveText(["Livre", "Livre"]);
  await expect(occurrence("Livre", 2, 2)).toBeFocused();
  for (let count = 2; count < 31; count++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await expect(words).toHaveCount(count + 1);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await choose("Eau", 31, 31, "Maman", true);
  await expect(previewWords).toHaveCount(32);
  assert(
    await preview.evaluate((node) => node.scrollHeight > node.clientHeight),
  );
  await expect
    .poll(() =>
      preview.evaluate((node) => {
        const chosen = node
          .querySelector('[aria-current="step"]')
          .getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return (
          chosen.top >= bounds.top - 1 && chosen.bottom <= bounds.bottom + 1
        );
      }),
    )
    .toBe(true);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const bounds = await dialog.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await dialog.screenshot({
    path: ".local/message-insertion/review-mobile.png",
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(mode).toBeDisabled();
  await expect(
    group.getByRole("button", {
      name: "Retirer « Maman », touche 32 sur 32",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    message.getByRole("button", { name: "Remplacer une touche", exact: true }),
  ).toBeEnabled();
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  const fullIds = [book.id, book.id, ...Array(29).fill(water.id), mother.id];
  assert.deepEqual((await call(path)).block_ids, fullIds);
  // Free a place on another device, then explicitly reload before attempting another edit.
  await call(path + "/selection", "POST", { action: "undo" });
  await page.reload();
  await expect(words).toHaveCount(31);
  await insertMode();
  await choose("Livre", 1, 31, "Maman");
  await call(path + "/selection", "POST", { action: "complete" });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await expect(
    message.getByRole("heading", { name: "Mon message terminé", exact: true }),
  ).toBeVisible();
  assert.deepEqual((await call(path)).block_ids, fullIds.slice(0, -1));
  const finalWrites = writes.length;
  await page.reload();
  await expect(words).toHaveCount(31);
  await expect(opener).toHaveCount(0);
  assert.equal(writes.length, finalWrites);
  for (const resource of Object.keys(before))
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  const inserts = writes.filter(
    (req) => req.postDataJSON()?.action === "insert",
  );
  assert.equal(inserts.length, 9); // Six applied, three conflicts; no automatic replay.
  for (const req of inserts)
    assert.deepEqual(Object.keys(req.postDataJSON()).sort(), [
      "action",
      "block_id",
      "expected_block_ids",
      "index",
    ]);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated insertion: before/after exact repeated anchors, local picture/word review, same-touch repetition, personal pages and lookup state, pending/lost/stale/offline recovery, profile reset, single/full/terminal drafts and memory/rhythm isolation passed.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({
        path: ".local/message-insertion/failure.png",
        fullPage: true,
      })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
