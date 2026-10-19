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
  await call("profiles", "POST", { display_name: "Correction fictive" })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre correction fictive" })
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
  username: "message-correction-ci",
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
  const group = message.getByRole("group", {
    name: "Touches à corriger",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Retirer cette touche du message ?",
    exact: true,
  });
  const keep = dialog.getByRole("button", {
    name: "Garder cette touche",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Oui, retirer cette touche",
    exact: true,
  });
  const occurrence = (label, index, total) =>
    group.getByRole("button", {
      name: `Retirer « ${label} », touche ${index} sur ${total}`,
      exact: true,
    });
  await expect(opener).toHaveCount(0);
  const created = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith(`/${base}/sequences`),
  );
  await keyboard.getByRole("button", { name: "Maman", exact: true }).click();
  const sequenceId = (await (await created).json()).id;
  const path = base + `/sequences/${sequenceId}`;
  const selectionURL = `**/api/pictoflow/${path}/selection`;
  await expect(words).toHaveText(["Maman"]);
  for (const [label, total] of [
    ["Eau", 2],
    ["Livre", 3],
    ["Eau", 4],
  ]) {
    await keyboard.getByRole("button", { name: label, exact: true }).click();
    await expect(words).toHaveCount(total);
  }
  const noEditCount = writes.length;
  const initialAudit = await call(base + "/audit");
  await opener.focus();
  await opener.press("Enter");
  await expect(occurrence("Maman", 1, 4)).toBeFocused();
  await occurrence("Eau", 2, 4).press("Enter");
  await expect(dialog).toBeVisible();
  await expect(keep).toBeFocused();
  await expect(dialog.locator(".touch-word")).toHaveText("Eau");
  await expect(dialog.locator("svg.pictogram")).toHaveCount(1);
  await keep.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(occurrence("Eau", 2, 4)).toBeFocused();
  await occurrence("Eau", 2, 4).click();
  await keep.click();
  assert.equal(writes.length, noEditCount);
  assert.deepEqual(await call(base + "/audit"), initialAudit);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await fs.mkdir(".local/message-correction", { recursive: true });
  await message.screenshot({
    path: ".local/message-correction/choose-occurrence-desktop.png",
  });

  await occurrence("Eau", 2, 4).press("Space");
  await confirm.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(words).toHaveText(["Maman", "Livre", "Eau"]);
  await expect(occurrence("Livre", 2, 3)).toBeFocused();
  assert.deepEqual((await call(path)).block_ids, [
    mother.id,
    book.id,
    water.id,
  ]);
  const firstRemoval = writes.filter(
    (req) => req.postDataJSON()?.action === "remove",
  );
  assert.equal(firstRemoval.length, 1);
  assert.deepEqual(firstRemoval[0].postDataJSON(), {
    action: "remove",
    index: 1,
    expected_block_ids: [mother.id, water.id, book.id, water.id],
  });
  await finish.press("Enter");
  await expect(opener).toBeFocused();
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Maman Livre Eau",
  ]);
  await opener.click();
  await occurrence("Livre", 2, 3).click();
  await keep.press("Escape"); // First Escape stops active speech, retaining the dialog.
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await keep.press("Escape");
  await expect(dialog).not.toBeVisible();
  await occurrence("Livre", 2, 3).press("Escape");
  await expect(opener).toBeFocused();

  // A response lost after commit is reconciled by GET, never by replaying removal.
  await opener.click();
  await occurrence("Livre", 2, 3).click();
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
  await expect(dialog).not.toBeVisible();
  await expect(words).toHaveText(["Maman", "Eau"]);
  assert.equal(uncertain, 1);
  assert.deepEqual((await call(path)).block_ids, [mother.id, water.id]);
  await page.unroute(selectionURL);

  // Another device removes the first word after the person opened confirmation.
  await occurrence("Eau", 2, 2).click();
  await call(path + "/selection", "POST", {
    action: "remove",
    index: 0,
    expected_block_ids: [mother.id, water.id],
  });
  const conflicted = page.waitForResponse(
    (r) => r.url().endsWith(`/${path}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflicted;
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "Le message a changé ailleurs",
  );
  await expect(words).toHaveText(["Eau"]);
  await expect(occurrence("Eau", 1, 1)).toBeFocused();
  assert.deepEqual((await call(path)).block_ids, [water.id]);

  // Local offline guards neither remove nor queue an edit on reconnection.
  await occurrence("Eau", 1, 1).click();
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await keep.click();
  await expect(occurrence("Eau", 1, 1)).toBeDisabled();
  await finish.click();
  await expect(opener).toBeDisabled();
  await page.context().setOffline(false);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
  await opener.click();
  await occurrence("Eau", 1, 1).click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(confirm).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: ".local/message-correction/confirm-mobile.png",
  });
  await confirm.click();
  await expect(words).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await expect(message.locator(".message-tokens")).toBeFocused();
  assert.equal((await call(path)).status, "in_progress");
  assert.deepEqual((await call(path)).block_ids, []);
  await expect(
    message.getByRole("button", { name: "Terminer mon message", exact: true }),
  ).toBeDisabled();

  // A full draft can be corrected; removal frees one place without changing the 32 limit.
  for (let i = 0; i < 32; i++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await expect(words).toHaveCount(i + 1);
  }
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  await opener.click();
  await occurrence("Eau", 16, 32).click();
  await confirm.click();
  await expect(words).toHaveCount(31);
  await expect(occurrence("Eau", 16, 31)).toBeFocused();
  await expect(
    keyboard.getByRole("button", { name: "Livre", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(words).toHaveCount(31);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  await expect(group).toHaveCount(0);
  await expect(dialog).not.toBeVisible();
  const beforeSwitch = writes.length;
  await page.goto(`${origin}/communication/${second}`);
  await expect(
    page.getByRole("button", { name: "Papa", exact: true }),
  ).toBeEnabled();
  await expect(words).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(31);
  assert.equal(writes.length, beforeSwitch);

  // A concurrent completion also rejects the pending removal, keeping the exact message.
  await opener.click();
  await occurrence("Eau", 1, 31).click();
  await call(path + "/selection", "POST", { action: "complete" });
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    message.getByRole("heading", { name: "Mon message terminé", exact: true }),
  ).toBeVisible();
  await expect(opener).toHaveCount(0);
  await expect(group).toHaveCount(0);
  await expect(words).toHaveCount(31);
  assert.deepEqual((await call(path)).block_ids, Array(31).fill(water.id));
  const finalWrites = writes.length;
  await page.reload();
  await expect(words).toHaveCount(31);
  await expect(opener).toHaveCount(0);
  assert.equal(writes.length, finalWrites);
  for (const resource of Object.keys(before))
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  const removals = writes.filter(
    (req) => req.postDataJSON()?.action === "remove",
  );
  assert.equal(removals.length, 6); // Four applied, two stale conflicts; no automatic retry.
  for (const req of removals)
    assert.deepEqual(Object.keys(req.postDataJSON()).sort(), [
      "action",
      "expected_block_ids",
      "index",
    ]);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated correction: exact occurrences, no-write cancellation, focus/Escape, stale/lost-response recovery, offline, empty/full/terminal drafts and memory isolation passed.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({
        path: ".local/message-correction/failure.png",
        fullPage: true,
      })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
