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
    display_name: "Copie personnelle fictive",
  })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre copie fictive" })
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
  username: "message-copy-ci",
  display_name: "Communication fictive",
  password,
});
for (const id of [profile, second])
  await call(`auth/users/${account.id}/profiles/${id}/capabilities`, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: null,
  });
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
    writes = [],
    copies = [];
  let modelCalls = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (
      req.url().includes(`/profiles/${profile}/`) &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
    )
      writes.push(req);
    if (req.url().endsWith("/copy") && req.method() === "POST")
      copies.push(req);
    if (req.url().endsWith("/interpret")) modelCalls++;
  });
  await fs.mkdir(".local/message-copy", { recursive: true });
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
    name: "Modifier une copie",
    exact: true,
  });
  const dialog = page.getByRole("dialog", {
    name: "Modifier une copie",
    exact: true,
  });
  const keep = dialog.getByRole("button", {
    name: "Garder mon message",
    exact: true,
  });
  const confirm = dialog.getByRole("button", {
    name: "Créer la copie modifiable",
    exact: true,
  });
  const preview = dialog.getByRole("list", {
    name: "Pictos de la copie",
    exact: true,
  });
  const finish = message.getByRole("button", {
    name: "Terminer mon message",
    exact: true,
  });
  const currentId = () =>
    page.evaluate(
      (p) =>
        JSON.parse(sessionStorage.getItem(`pictoflow:sequence:${p}`))
          .sequence_id,
      profile,
    );
  const copyKey = `pictoflow:sequence:copy:${profile}`;
  async function openCopy() {
    await opener.click();
    await expect(keep).toBeFocused();
  }
  async function complete() {
    await finish.click();
    await expect(opener).toBeEnabled();
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
  for (const [index, label] of ["Maman", "Eau", "Livre", "Eau"].entries()) {
    await keyboard.getByRole("button", { name: label, exact: true }).click();
    await expect(words).toHaveCount(index + 1);
  }
  await complete();
  const sourceId = await currentId();
  const path = base + `/sequences/${sourceId}`;
  const source = await call(path);
  const sourceRhythm = await call(path + "/rhythm");
  const accepted = await call(path + "/interpret", "POST", {});
  await call(
    base + `/interpretations/${accepted.candidates[0].id}/feedback`,
    "POST",
    {
      action: "correct",
      actor_role: "user",
      corrected_value: "Maman, je voudrais de l’eau et mon livre.",
    },
  );
  const before = {};
  for (const resource of [
    "memory",
    "keyboard",
    "blocks",
    "concepts",
    "representations",
    "interpretations",
  ])
    before[resource] = await call(base + "/" + resource);
  const untouched = writes.length;
  const auditBefore = await call(base + "/audit");
  await openCopy();
  await expect(preview.locator(".touch-word")).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
  ]);
  await expect(preview.locator("svg.pictogram")).toHaveCount(4);
  await dialog.screenshot({ path: ".local/message-copy/review-desktop.png" });
  await keep.click();
  await expect(opener).toBeFocused();
  assert.equal(writes.length, untouched);
  assert.equal(
    await page.evaluate((k) => sessionStorage.getItem(k), copyKey),
    null,
  );
  assert.deepEqual(await call(base + "/audit"), auditBefore);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  await openCopy();
  await keep.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);
  await openCopy();
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await keep.click();
  await page.context().setOffline(false);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
  await openCopy();
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeEnabled();
  await openCopy();
  await page.goto(`${origin}/communication/${second}`);
  await expect(
    page.getByRole("button", { name: "Papa", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(opener).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
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
  await openCopy();
  const copyURL = `**/api/pictoflow/${path}/copy`;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let pendingCopies = 0;
  await page.route(copyURL, async (route) => {
    pendingCopies++;
    await held;
    await route.continue();
  });
  await confirm.press("Enter");
  await expect.poll(() => pendingCopies).toBe(1);
  await expect(confirm).toBeDisabled();
  await expect(keep).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Création de la copie…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(finish).toBeEnabled();
  await expect(
    message.getByRole("heading", { name: "Mon message", exact: true }),
  ).toBeFocused();
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  assert.equal(pendingCopies, 1);
  await page.unroute(copyURL);
  const firstCopyId = await currentId();
  assert.equal(firstCopyId, copies[0].postDataJSON().request_id);
  assert.notEqual(firstCopyId, sourceId);
  assert.deepEqual(await call(path), source);
  assert.deepEqual(
    (await call(base + `/sequences/${firstCopyId}/rhythm`)).intervals,
    [],
  );
  await expect(opener).toHaveCount(0);
  // The new copy uses the existing correction controls; its source stays immutable.
  await message
    .getByRole("button", { name: "Corriger une touche", exact: true })
    .click();
  await message
    .getByRole("button", { name: "Remplacer une touche", exact: true })
    .click();
  await message
    .getByRole("button", {
      name: "Remplacer « Eau », touche 2 sur 4",
      exact: true,
    })
    .click();
  const replacement = page.getByRole("dialog", {
    name: "Remplacer une touche",
    exact: true,
  });
  await replacement
    .getByRole("region", { name: "Clavier de remplacement", exact: true })
    .getByRole("button", { name: "Livre", exact: true })
    .click();
  await replacement
    .getByRole("button", { name: "Confirmer le remplacement", exact: true })
    .click();
  await expect(words).toHaveText(["Maman", "Livre", "Livre", "Eau"]);
  await keyboard.getByRole("button", { name: "Maman", exact: true }).click();
  await expect(words).toHaveCount(5);
  assert.equal(
    writes
      .filter((r) => r.postDataJSON()?.action === "append")
      .at(-1)
      .postDataJSON().observation.interval_ms,
    null,
  );
  assert.deepEqual(await call(path), source);
  await complete();
  // A committed-but-lost copy response is resolved with a source-bound GET, not another POST.
  await openCopy();
  const secondURL = `**/api/pictoflow/${base}/sequences/${firstCopyId}/copy`;
  await page.route(secondURL, async (route) => {
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(finish).toBeEnabled();
  await expect(
    page.getByText(
      "Votre copie a été retrouvée après la coupure. Vérifiez ses pictos avant de continuer.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(copies.length, 2);
  await page.unroute(secondURL);
  const secondCopyId = await currentId();
  await complete();
  await openCopy();
  const thirdURL = `**/api/pictoflow/${base}/sequences/${secondCopyId}/copy`;
  const lookupURL = `**/api/pictoflow/${base}/sequences/${secondCopyId}/copies/*`;
  await page.route(thirdURL, async (route) => {
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await page.route(lookupURL, (route) => route.abort("failed"));
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "La copie ne peut pas être vérifiée",
  );
  await expect(opener).toBeDisabled();
  const pendingRecord = await page.evaluate(
    (k) => JSON.parse(sessionStorage.getItem(k)),
    copyKey,
  );
  assert.deepEqual(Object.keys(pendingRecord).sort(), [
    "requestId",
    "sourceId",
  ]);
  assert.equal(pendingRecord.sourceId, secondCopyId);
  assert.equal(pendingRecord.requestId, copies[2].postDataJSON().request_id);
  await page.unroute(thirdURL);
  await page.unroute(lookupURL);
  await page.reload();
  await expect(finish).toBeEnabled();
  assert.equal(await currentId(), pendingRecord.requestId);
  assert.equal(copies.length, 3);
  assert.equal(
    await page.evaluate((k) => sessionStorage.getItem(k), copyKey),
    null,
  );
  // A failed creation with no server copy keeps the same identity across reload and manual retry.
  await complete();
  const thirdCopyId = await currentId();
  const failedURL = `**/api/pictoflow/${base}/sequences/${thirdCopyId}/copy`;
  await page.route(failedURL, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await openCopy();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "La copie n’a pas été retrouvée",
  );
  await expect(opener).toBeEnabled();
  assert.equal(copies.length, 4);
  const retryId = copies[3].postDataJSON().request_id;
  await page.unroute(failedURL);
  await page.reload();
  await expect(opener).toBeEnabled();
  await openCopy();
  await confirm.click();
  await expect(finish).toBeEnabled();
  assert.equal(copies.length, 5);
  assert.equal(copies[4].postDataJSON().request_id, retryId);
  assert.equal(await currentId(), retryId);
  for (let count = 5; count < 32; count++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await expect(words).toHaveCount(count + 1);
  }
  await complete();
  await page.setViewportSize({ width: 320, height: 844 });
  await openCopy();
  await expect(preview.locator(".touch-word")).toHaveCount(32);
  assert(
    await preview.evaluate((node) => node.scrollHeight > node.clientHeight),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const bounds = await dialog.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await dialog.screenshot({ path: ".local/message-copy/review-mobile.png" });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(
    keyboard.getByRole("button", { name: "Eau", exact: true }),
  ).toBeDisabled();
  await expect(
    message.getByRole("button", { name: "Corriger une touche", exact: true }),
  ).toBeEnabled();
  assert.equal(copies.length, 6);
  const finalId = await currentId();
  const finalDraft = await call(base + `/sequences/${finalId}`);
  assert.equal(finalDraft.status, "in_progress");
  await page.reload();
  await expect(words).toHaveCount(32);
  assert.equal(await currentId(), finalId);
  assert.equal(copies.length, 6);
  // A stale source touch is rejected atomically on another authorized profile.
  await page.goto(`${origin}/communication/${second}`);
  await page.getByRole("button", { name: "Papa", exact: true }).click();
  await expect(words).toHaveText(["Papa"]);
  await complete();
  await openCopy();
  const father = (await call(`profiles/${second}/blocks`))[0];
  await call(`profiles/${second}/blocks/${father.id}/feedback`, "POST", {
    action: "reject",
    actor_role: "user",
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "La copie ne peut pas être créée",
  );
  await expect(words).toHaveText(["Papa"]);
  assert.equal(copies.length, 7);
  const failedId = copies[6].postDataJSON().request_id;
  const missing = await admin.get(
    `/api/pictoflow/profiles/${second}/sequences/${failedId}`,
  );
  assert.equal(missing.status(), 404);
  for (const resource of Object.keys(before))
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  assert.deepEqual(await call(path), source);
  assert.deepEqual(await call(path + "/rhythm"), sourceRhythm);
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  for (const req of copies)
    assert.deepEqual(Object.keys(req.postDataJSON()).sort(), [
      "confirm",
      "expected_block_ids",
      "request_id",
    ]);
  console.log(
    "Authenticated editable copy: ordered/repeated selections, no-write local cancellation, mouse/keyboard/focus, speech priority, pending/offline guards, source-bound lost-response recovery, failed-reread reload, idempotent manual retry, 32 touches, unavailable source and unchanged accepted memory/rhythm passed.",
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: ".local/message-copy/failure.png", fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
