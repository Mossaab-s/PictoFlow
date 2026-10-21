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
  await call("profiles", "POST", { display_name: "Ordre personnel fictif" })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre ordre fictif" })
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
  username: "message-order-ci",
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
  // Exercise the detailed tools available from Options.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("pictoflow:communication-view", "tools");
    } catch {}
  });
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
  await fs.mkdir(".local/message-order", { recursive: true });
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
  const moveMode = message.getByRole("button", {
    name: "Déplacer une touche",
    exact: true,
  });
  const removeMode = message.getByRole("button", {
    name: "Retirer une touche",
    exact: true,
  });
  const group = message.getByRole("group", {
    name: "Touches à corriger",
    exact: true,
  });
  const occurrence = (label, index, total) =>
    group.getByRole("button", {
      name: `Déplacer « ${label} », touche ${index} sur ${total}`,
      exact: true,
    });
  const dialog = page.getByRole("dialog", {
    name: "Changer l’ordre du message",
    exact: true,
  });
  const keep = dialog.getByRole("button", {
    name: "Garder l’ordre actuel",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirmer cet ordre",
    exact: true,
  });
  const place = dialog.getByLabel("Nouvelle place", { exact: true });
  const preview = dialog.getByRole("list", {
    name: "Ordre proposé",
    exact: true,
  });
  const previewWords = preview.locator(".touch-word");
  async function choose(label, ordinal, total, destination) {
    await occurrence(label, ordinal, total).click();
    await expect(keep).toBeFocused();
    await expect(confirm).toBeDisabled();
    if (destination !== undefined)
      await place.selectOption(String(destination));
  }
  await expect(opener).toHaveCount(0);
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
  for (const [index, label] of ["Eau", "Maman", "Livre", "Eau"].entries()) {
    const key = keyboard.getByRole("button", { name: label, exact: true });
    if (index % 2 === 0) {
      await key.focus();
      await key.press("Enter");
    } else await key.click();
    await expect(words).toHaveCount(index + 1);
    await expect(key).toBeEnabled();
    if (index === 0) {
      await opener.click();
      await expect(moveMode).toBeDisabled();
      await finish.click();
    }
  }
  const sequenceId = (await (await created).json()).id;
  const path = base + `/sequences/${sequenceId}`;
  const selectionURL = `**/api/pictoflow/${path}/selection`;
  const noMoveWrites = writes.length;
  const noMoveAudit = await call(base + "/audit");
  const rhythm = await call(path + "/rhythm");
  assert.equal(rhythm.intervals.length, 3);
  await opener.press("Enter");
  await expect(removeMode).toHaveAttribute("aria-pressed", "true");
  await moveMode.press("Enter");
  await expect(occurrence("Eau", 1, 4)).toBeFocused();
  await choose("Maman", 2, 4, 0);
  await expect(previewWords).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await expect(preview.locator("svg.pictogram")).toHaveCount(4);
  await expect(words).toHaveText(["Eau", "Maman", "Livre", "Eau"]);
  await keep.click();
  await expect(occurrence("Maman", 2, 4)).toBeFocused();
  assert.equal(writes.length, noMoveWrites);
  assert.deepEqual(await call(base + "/audit"), noMoveAudit);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);

  await choose("Maman", 2, 4);
  await dialog
    .getByRole("button", { name: "← Une place avant", exact: true })
    .press("Enter");
  await expect(place).toHaveValue("0");
  await expect(
    dialog.getByRole("button", { name: "← Une place avant", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Une place après →", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "Une place après →", exact: true })
    .click();
  await expect(confirm).toBeDisabled();
  await place.selectOption("0");
  await dialog.screenshot({ path: ".local/message-order/preview-desktop.png" });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let pendingMoves = 0;
  await page.route(selectionURL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    pendingMoves++;
    await held;
    await route.continue();
  });
  await confirm.press("Enter");
  await expect.poll(() => pendingMoves).toBe(1);
  await expect(confirm).toBeDisabled();
  await expect(keep).toBeDisabled();
  await expect(place).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Déplacement en cours…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await expect(occurrence("Maman", 1, 4)).toBeFocused();
  assert.equal(pendingMoves, 1);
  assert.deepEqual((await call(path)).block_ids, [
    mother.id,
    water.id,
    book.id,
    water.id,
  ]);
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await page.unroute(selectionURL);
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Maman Eau Livre Eau",
  ]);
  await choose("Maman", 1, 4, 3);
  await keep.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);

  await keyboard.getByRole("button", { name: "Livre", exact: true }).click();
  await expect(words).toHaveCount(5);
  const afterEditAppend = writes
    .filter((req) => req.postDataJSON()?.action === "append")
    .at(-1)
    .postDataJSON();
  assert.equal(afterEditAppend.observation.interval_ms, null); // Correction time is not a new interval.
  assert.deepEqual(await call(path + "/rhythm"), rhythm);
  await choose("Eau", 4, 5, 1);
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
  await expect(words).toHaveText(["Maman", "Eau", "Eau", "Livre", "Livre"]);
  assert.equal(uncertain, 1);
  await page.unroute(selectionURL);
  await choose("Maman", 1, 5, 4);
  await call(path + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${path}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "Le message a changé ailleurs",
  );
  await expect(words).toHaveText(["Maman", "Eau", "Eau", "Livre"]);
  await expect(occurrence("Livre", 4, 4)).toBeFocused();
  assert.deepEqual((await call(path)).block_ids, [
    mother.id,
    water.id,
    water.id,
    book.id,
  ]);
  await choose("Maman", 1, 4, 3);
  for (let i = 0; i < 3; i++)
    await call(path + "/selection", "POST", { action: "undo" });
  await confirm.click();
  await expect(words).toHaveText(["Maman"]);
  await expect(removeMode).toHaveAttribute("aria-pressed", "true");
  await expect(moveMode).toBeDisabled();
  await expect(
    group.getByRole("button", {
      name: "Retirer « Maman », touche 1 sur 1",
      exact: true,
    }),
  ).toBeFocused();
  for (const [index, label] of ["Eau", "Eau", "Livre"].entries()) {
    await keyboard.getByRole("button", { name: label, exact: true }).click();
    await expect(words).toHaveCount(index + 2);
  }
  await moveMode.click();
  await choose("Maman", 1, 4, 3);
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await expect(place).toBeDisabled();
  await keep.click();
  await finish.click();
  await expect(opener).toBeDisabled();
  await page.context().setOffline(false);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);

  await opener.click();
  await moveMode.click();
  await choose("Livre", 4, 4, 0);
  const beforeSwitch = writes.length;
  await page.goto(`${origin}/communication/${second}`);
  await expect(
    page.getByRole("button", { name: "Papa", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await expect(words).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(4);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  assert.equal(writes.length, beforeSwitch);
  await opener.click();
  await expect(removeMode).toHaveAttribute("aria-pressed", "true");
  await moveMode.click();
  await choose("Livre", 4, 4, 0);
  await page.reload();
  await expect(words).toHaveCount(4);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-pressed", "false");
  await opener.click();
  await moveMode.click();
  await choose("Livre", 4, 4, 0);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(confirm).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const bounds = await dialog.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await page.screenshot({ path: ".local/message-order/preview-mobile.png" });
  await keep.click();
  for (let count = 4; count < 32; count++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await expect(words).toHaveCount(count + 1);
  }
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  await choose("Livre", 4, 32, 31);
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
  await dialog.screenshot({
    path: ".local/message-order/long-preview-mobile.png",
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(occurrence("Livre", 32, 32)).toBeFocused();
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  const finalIds = [mother.id, ...Array(30).fill(water.id), book.id];
  assert.deepEqual((await call(path)).block_ids, finalIds);
  const noOpCount = writes.length;
  await choose("Eau", 2, 32, 2);
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText(
    "L’ordre reste inchangé.",
  );
  await keep.click();
  assert.equal(writes.length, noOpCount);
  await choose("Maman", 1, 32, 1);
  await call(path + "/selection", "POST", { action: "complete" });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await expect(group).toHaveCount(0);
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
  const moves = writes.filter((req) => req.postDataJSON()?.action === "move");
  assert.equal(moves.length, 6); // Three applied, three stale conflicts; no automatic replay.
  for (const req of moves)
    assert.deepEqual(Object.keys(req.postDataJSON()).sort(), [
      "action",
      "expected_block_ids",
      "index",
      "target_index",
    ]);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []); // Reload resets the synthetic voice log.
  console.log(
    "Authenticated ordering: repeated occurrences, explicit local preview/confirmation, no-ops, pending/offline guards, stale/lost-response recovery, rhythm reset, full/terminal drafts and profile/memory isolation passed.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: ".local/message-order/failure.png", fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
