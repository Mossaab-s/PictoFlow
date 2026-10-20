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
    display_name: "Remplacement personnel fictif",
  })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre remplacement fictif" })
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
  username: "message-replacement-ci",
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
  await fs.mkdir(".local/message-replacement", { recursive: true });
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
    name: "Remplacer une touche",
    exact: true,
  });
  const group = message.getByRole("group", {
    name: "Touches à corriger",
    exact: true,
  });
  const occurrence = (word, ordinal, total) =>
    group.getByRole("button", {
      name: `Remplacer « ${word} », touche ${ordinal} sur ${total}`,
      exact: true,
    });
  const dialog = page.getByRole("dialog", {
    name: "Remplacer une touche",
    exact: true,
  });
  const picker = dialog.getByRole("region", {
    name: "Clavier de remplacement",
    exact: true,
  });
  const keep = dialog.getByRole("button", {
    name: "Garder la touche actuelle",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirmer le remplacement",
    exact: true,
  });
  const another = dialog.getByRole("button", {
    name: "Choisir une autre touche",
    exact: true,
  });
  const heading = dialog.getByRole("heading", {
    name: "Vérifier le remplacement",
    exact: true,
  });
  async function choose(word, ordinal, total, replacement) {
    await occurrence(word, ordinal, total).click();
    await expect(keep).toBeFocused();
    if (replacement !== undefined) {
      await picker
        .getByRole("button", { name: replacement, exact: true })
        .click();
      await expect(heading).toBeFocused();
    }
  }
  async function replaceMode() {
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
  const sequenceId = (await (await created).json()).id;
  const path = base + `/sequences/${sequenceId}`;
  const selectionURL = `**/api/pictoflow/${path}/selection`;
  const rhythm = await call(path + "/rhythm");
  assert.equal(rhythm.intervals.length, 3);
  const untouched = writes.length;
  const auditBefore = await call(base + "/audit");
  await replaceMode();
  await choose("Eau", 2, 4, "Eau");
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText(
    "Cette touche est déjà à cette place.",
  );
  await another.click();
  await expect(
    picker.getByRole("button", { name: "Eau", exact: true }),
  ).toBeFocused();
  // Same word on a different personal page remains a distinct replacement identity.
  await picker.getByRole("button", { name: "Sorties", exact: true }).click();
  await picker.getByRole("button", { name: "Eau", exact: true }).press("Enter");
  await expect(heading).toBeFocused();
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator(".replacement-comparison")).toContainText(
    "Sorties",
  );
  await another.click();
  await expect(
    picker.getByRole("button", { name: "Sorties", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await keep.click();
  await expect(occurrence("Eau", 2, 4)).toBeFocused();
  assert.equal(writes.length, untouched);
  assert.deepEqual(await call(base + "/audit"), auditBefore);
  await expect(
    keyboard.getByRole("button", { name: "Accueil", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await choose("Eau", 2, 4);
  await picker
    .getByRole("button", { name: "Retrouver une touche", exact: true })
    .click();
  const input = picker.getByLabel("Chercher le mot de ma touche", {
    exact: true,
  });
  await input.fill("Livre");
  const result = picker.locator(".touch-search-results").getByRole("button", {
    name: "Choisir « Livre » pour le remplacement",
    exact: true,
  });
  await result.press("Enter");
  await expect(heading).toBeFocused();
  await expect(
    dialog.locator(".replacement-comparison .touch-word"),
  ).toHaveText(["Eau", "Livre"]);
  await expect(
    dialog.locator(".replacement-comparison svg.pictogram"),
  ).toHaveCount(2);
  await another.click();
  await expect(result).toBeFocused();
  await expect(input).toHaveValue("Livre");
  await result.click();
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await dialog.screenshot({
    path: ".local/message-replacement/review-desktop.png",
  });
  assert.equal(writes.length, untouched);
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
  await expect(another).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Remplacement en cours…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Livre", "Livre", "Eau"]);
  await expect(occurrence("Livre", 2, 4)).toBeFocused();
  assert.equal(pending, 1);
  assert.deepEqual((await call(path)).block_ids, [
    mother.id,
    book.id,
    book.id,
    water.id,
  ]);
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await page.unroute(selectionURL);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Maman Livre Livre Eau",
  ]);
  await choose("Livre", 2, 4, "Maman");
  await keep.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);

  await keyboard.getByRole("button", { name: "Livre", exact: true }).click();
  await expect(words).toHaveCount(5);
  assert.equal(
    writes
      .filter((req) => req.postDataJSON()?.action === "append")
      .at(-1)
      .postDataJSON().observation.interval_ms,
    null,
  );
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await choose("Livre", 2, 5, "Maman");
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
  await expect(words).toHaveText(["Maman", "Maman", "Livre", "Eau", "Livre"]);
  await expect(occurrence("Maman", 2, 5)).toBeFocused();
  assert.equal(uncertain, 1);
  await page.unroute(selectionURL);
  await choose("Maman", 1, 5, "Livre");
  await call(path + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${path}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "Votre remplacement n’a pas été appliqué",
  );
  await expect(words).toHaveText(["Maman", "Maman", "Livre", "Eau"]);
  await expect(occurrence("Maman", 1, 4)).toBeFocused();
  await choose("Maman", 1, 4, "Livre");
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await keep.click();
  await finish.click();
  await expect(opener).toBeDisabled();
  await page.context().setOffline(false);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
  await replaceMode();
  await choose("Maman", 1, 4, "Eau");
  const beforeSwitch = writes.length;
  await page.goto(`${origin}/communication/${second}`);
  await expect(
    page.getByRole("button", { name: "Papa", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(4);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  assert.equal(writes.length, beforeSwitch);
  await replaceMode();
  await choose("Maman", 1, 4, "Livre");
  await page.reload();
  await expect(words).toHaveCount(4);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-pressed", "false");

  // Reconciliation may leave a single touch: replacement still works.
  await replaceMode();
  await choose("Maman", 1, 4, "Livre");
  for (let i = 0; i < 3; i++)
    await call(path + "/selection", "POST", { action: "undo" });
  await confirm.click();
  await expect(words).toHaveText(["Maman"]);
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await choose("Maman", 1, 1, "Eau");
  await confirm.click();
  await expect(words).toHaveText(["Eau"]);
  await expect(occurrence("Eau", 1, 1)).toBeFocused();
  for (let count = 1; count < 32; count++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await expect(words).toHaveCount(count + 1);
  }
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 844 });
  await choose("Eau", 32, 32);
  await expect(
    picker.getByRole("button", { name: "Livre", exact: true }),
  ).toBeEnabled();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await dialog.screenshot({
    path: ".local/message-replacement/picker-mobile.png",
  });
  await picker.getByRole("button", { name: "Livre", exact: true }).click();
  await expect(heading).toBeFocused();
  const bounds = await dialog.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await dialog.screenshot({
    path: ".local/message-replacement/review-mobile.png",
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(occurrence("Livre", 32, 32)).toBeFocused();
  const finalIds = [...Array(31).fill(water.id), book.id];
  assert.deepEqual((await call(path)).block_ids, finalIds);
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  await choose("Livre", 32, 32, "Maman");
  await call(path + "/selection", "POST", { action: "complete" });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await expect(
    message.getByRole("heading", { name: "Mon message terminé", exact: true }),
  ).toBeVisible();
  assert.deepEqual((await call(path)).block_ids, finalIds);
  const finalWrites = writes.length;
  await page.reload();
  await expect(words).toHaveCount(32);
  await expect(opener).toHaveCount(0);
  assert.equal(writes.length, finalWrites);
  for (const resource of Object.keys(before))
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  const replacements = writes.filter(
    (req) => req.postDataJSON()?.action === "replace",
  );
  assert.equal(replacements.length, 7); // Four applied, three conflicts; no automatic replay.
  for (const req of replacements)
    assert.deepEqual(Object.keys(req.postDataJSON()).sort(), [
      "action",
      "block_id",
      "expected_block_ids",
      "index",
    ]);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated replacement: picture/word review, personal pages, same-word identities, preserved lookup state, exact repetitions, pending/lost/stale/offline recovery, single/full/terminal drafts, rhythm and accepted-memory isolation passed.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({
        path: ".local/message-replacement/failure.png",
        fullPage: true,
      })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
