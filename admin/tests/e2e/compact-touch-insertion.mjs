import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";

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
    display_name: "Ajout compact fictif",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre ajout fictif" })
).id;
const base = `profiles/${profile}`;
async function touch(label, drawing, position) {
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: drawing,
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    confirm_representation: true,
    actor_role: "user",
  });
  await call(base + `/keyboard/${block.id}`, "PUT", {
    zone: "personal",
    position,
    actor_role: "user",
  });
  return block;
}
const mother = await touch("Maman", "mother", 0);
const water = await touch("Eau", "water", 1);
const book = await touch("Livre", "book", 2);
async function draft(ids) {
  let sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  for (const block_id of ids)
    sequence = await call(
      base + `/sequences/${sequence.id}/selection`,
      "POST",
      { action: "append", block_id },
    );
  return sequence;
}
const originalIds = [mother.id, water.id, book.id, water.id];
let source = await draft(originalIds);
source = await call(base + `/sequences/${source.id}/selection`, "POST", {
  action: "complete",
});
const decision = await call(
  base + `/sequences/${source.id}/interpret`,
  "POST",
  {},
);
await call(
  base + `/interpretations/${decision.candidates[0].id}/feedback`,
  "POST",
  { action: "confirm", actor_role: "user" },
);
source = await call(base + `/sequences/${source.id}`);
const account = await call("auth/users", "POST", {
  username: "compact-touch-insertion-ci",
  display_name: "Ajout communicant fictif",
  password,
});
for (const id of [profile, other])
  await call(`auth/users/${account.id}/profiles/${id}/capabilities`, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: null,
  });
const before = {};
for (const resource of ["memory", "keyboard", "blocks", "representations"])
  before[resource] = await call(base + "/" + resource);
const browser = await chromium.launch({ headless: true });
let page;
const report = {
  status: "running",
  viewports: [],
  preview_writes: 0,
  copies: 0,
  model_requests: 0,
};
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const spoken = [];
  await page.exposeFunction("__recordSpeech", (text) => spoken.push(text));
  await page.addInitScript(() => {
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
          },
        ],
        speak(u) {
          void window.__recordSpeech(u.text);
          u.onstart?.();
        },
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  const errors = [],
    writes = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (
      req.url().includes(`/api/pictoflow/${base}/`) &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
    ) {
      writes.push({
        path: new URL(req.url()).pathname,
        body: req.postDataJSON(),
      });
      if (req.url().endsWith("/copy")) report.copies++;
    }
    if (req.url().endsWith("/interpret")) report.model_requests++;
  });
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(account.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.evaluate(
    ({ profile, source, decision }) => {
      localStorage.setItem(`pictoflow:automatic:${profile}`, "off");
      sessionStorage.setItem(
        `pictoflow:sequence:${profile}`,
        JSON.stringify({
          sequence_id: source,
          decision: {
            state: decision.state,
            candidate_ids: decision.candidates.map((c) => c.id),
          },
        }),
      );
    },
    { profile, source: source.id, decision },
  );
  await page.goto(`${origin}/communication/${profile}`);
  const surface = page.locator(".compact-communication");
  const words = surface.locator(".compact-word .touch-word");
  const occurrence = (label, ordinal, total) =>
    surface.getByRole("button", {
      name: `Modifier « ${label} », touche ${ordinal} sur ${total}`,
      exact: true,
    });
  const chooser = page.getByRole("dialog", {
    name: "Modifier cette touche",
    exact: true,
  });
  const add = chooser.getByRole("button", {
    name: "Ajouter une touche ici",
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
  async function choose(label, ordinal, total, added, after = false) {
    await occurrence(label, ordinal, total).press("Enter");
    await expect(
      chooser.getByRole("button", { name: "Garder cette touche", exact: true }),
    ).toBeFocused();
    await add.click();
    await expect(keep).toBeFocused();
    if (added) {
      await picker.getByRole("button", { name: added, exact: true }).click();
      await expect(heading).toBeFocused();
      if (after) await position.selectOption("after");
    }
  }
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await choose("Eau", 4, 4);
  await picker
    .getByRole("button", { name: "Retrouver une touche", exact: true })
    .click();
  const input = picker.getByLabel("Chercher le mot de ma touche", {
    exact: true,
  });
  await input.fill("maman");
  const result = picker.getByRole("button", {
    name: "Choisir « Maman » pour l’insertion",
    exact: true,
  });
  await result.press("Enter");
  await expect(heading).toBeFocused();
  await expect(preview.locator(".touch-word")).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Maman",
    "Eau",
  ]);
  await expect(preview.locator('[aria-current="step"] .touch-word')).toHaveText(
    "Maman",
  );
  await expect(preview.locator("svg")).toHaveCount(5);
  await position.selectOption("after");
  await expect(preview.locator(".touch-word")).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
  ]);
  await another.click();
  await expect(result).toBeFocused();
  await expect(input).toHaveValue("maman");
  await result.click();
  await expect(position).toHaveValue("after");
  await fs.mkdir(".local/compact-touch-insertion", { recursive: true });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await dialog.screenshot({
      path: `.local/compact-touch-insertion/review-${width}.png`,
    });
    report.viewports.push(width);
  }
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(occurrence("Eau", 4, 4)).toBeFocused();
  report.preview_writes = writes.length;
  assert.equal(report.preview_writes, 0);
  assert.equal((await call(base + "/sequences")).length, 1);

  // Only explicit confirmation creates an independent copy and inserts into it.
  await choose("Eau", 4, 4, "Maman", true);
  const copyURL = `**/api/pictoflow/${base}/sequences/${source.id}/copy`;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let pending = 0;
  await page.route(copyURL, async (route) => {
    pending++;
    await held;
    await route.continue();
  });
  const copied = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/sequences/${source.id}/copy`),
  );
  await confirm.press("Enter");
  await expect.poll(() => pending).toBe(1);
  await expect(confirm).toBeDisabled();
  await expect(keep).toBeDisabled();
  await expect(position).toBeDisabled();
  await expect(another).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await confirm.evaluate((node) => node.click());
  release();
  const copy = await (await copied).json();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau", "Maman"]);
  await expect(occurrence("Maman", 5, 5)).toBeFocused();
  await page.unroute(copyURL);
  assert.notEqual(copy.id, source.id);
  assert.equal(report.copies, 1);
  assert.equal(pending, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, {
    action: "insert",
    index: 4,
    expected_block_ids: originalIds,
    block_id: mother.id,
  });
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(await call(base + "/memory"), before.memory);
  const copyPath = base + `/sequences/${copy.id}`;
  assert.deepEqual((await call(copyPath)).block_ids, [
    ...originalIds,
    mother.id,
  ]);

  // Same-identity repetition is intentional; a lost response never replays it.
  await choose("Eau", 2, 5, "Eau", true);
  const selectionURL = `**/api/pictoflow/${copyPath}/selection`;
  let uncertain = 0;
  await page.route(selectionURL, async (route) => {
    uncertain++;
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText([
    "Maman",
    "Eau",
    "Eau",
    "Livre",
    "Eau",
    "Maman",
  ]);
  await expect(occurrence("Eau", 3, 6)).toBeFocused();
  assert.equal(uncertain, 1);
  assert.equal(report.copies, 1);
  await page.unroute(selectionURL);

  await choose("Livre", 4, 6, "Maman");
  await call(copyPath + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${copyPath}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau", "Eau", "Livre", "Eau"]);
  await expect(surface.getByRole("status")).toContainText(
    "Votre ajout n’a pas été appliqué",
  );
  await expect(occurrence("Livre", 4, 5)).toBeFocused();
  await choose("Eau", 2, 5, "Livre");
  const offlineWrites = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await expect(position).toBeDisabled();
  await keep.click();
  await expect(dialog).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(occurrence("Eau", 2, 5)).toBeEnabled();
  assert.equal(writes.length, offlineWrites);

  // Insert before the first occurrence even in a single-touch draft.
  const single = await draft([water.id]);
  await page.evaluate(
    ({ profile, id }) =>
      sessionStorage.setItem(
        `pictoflow:sequence:${profile}`,
        JSON.stringify({ sequence_id: id }),
      ),
    { profile, id: single.id },
  );
  await page.reload();
  await expect(words).toHaveText(["Eau"]);
  await choose("Eau", 1, 1, "Maman");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau"]);
  await expect(occurrence("Maman", 1, 2)).toBeFocused();
  assert.deepEqual((await call(base + `/sequences/${single.id}`)).block_ids, [
    mother.id,
    water.id,
  ]);

  // The final gap reaches32, with the inserted occurrence followed in its preview.
  const nearFullIds = Array(31).fill(water.id);
  const nearFull = await draft(nearFullIds);
  await page.evaluate(
    ({ profile, id }) =>
      sessionStorage.setItem(
        `pictoflow:sequence:${profile}`,
        JSON.stringify({ sequence_id: id }),
      ),
    { profile, id: nearFull.id },
  );
  await page.reload();
  await expect(words).toHaveCount(31);
  await choose("Eau", 31, 31, "Livre", true);
  await expect(preview.locator(".touch-word")).toHaveCount(32);
  await expect
    .poll(() =>
      preview.evaluate((node) => {
        const item = node
          .querySelector('[aria-current="step"]')
          .getBoundingClientRect();
        const bounds = node.getBoundingClientRect();
        return item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1;
      }),
    )
    .toBe(true);
  await preview.scrollIntoViewIfNeeded();
  await dialog.screenshot({
    path: ".local/compact-touch-insertion/last-place-320.png",
  });
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(occurrence("Livre", 32, 32)).toBeFocused();
  assert.deepEqual((await call(base + `/sequences/${nearFull.id}`)).block_ids, [
    ...nearFullIds,
    book.id,
  ]);
  await occurrence("Livre", 32, 32).click();
  await expect(add).toBeDisabled();
  await expect(
    chooser.getByText("Le message contient déjà 32 pictos.", { exact: false }),
  ).toBeVisible();
  for (const name of [
    "Remplacer cette touche",
    "Déplacer cette touche",
    "Retirer cette touche",
  ])
    await expect(
      chooser.getByRole("button", { name, exact: true }),
    ).toBeEnabled();
  await chooser
    .getByRole("button", { name: "Garder cette touche", exact: true })
    .click();
  assert.equal(report.copies, 1);

  await call(base + `/sequences/${nearFull.id}/selection`, "POST", {
    action: "undo",
  });
  await page.evaluate(
    (p) => localStorage.removeItem(`pictoflow:automatic:${p}`),
    profile,
  );
  await page.reload();
  const pauseWrites = writes.length;
  await choose("Eau", 31, 31, "Maman", true);
  await page.waitForTimeout(1500);
  assert.equal(writes.length, pauseWrites);
  assert.equal(report.model_requests, 0);
  await page.evaluate(
    (p) => localStorage.setItem(`pictoflow:automatic:${p}`, "off"),
    profile,
  );
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(31);
  await choose("Eau", 1, 31, "Maman");
  await page.goto(`${origin}/communication/${other}`);
  await expect(dialog).toHaveCount(0);
  await expect(chooser).toHaveCount(0);
  await expect(words).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(31);
  await expect(dialog).toHaveCount(0);
  assert.equal(writes.length, pauseWrites);
  for (const resource of ["memory", "keyboard", "blocks", "representations"])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(spoken, []);
  assert.equal(report.model_requests, 0);
  assert.deepEqual(errors, []);
  report.status = "passed";
  console.log(
    "Compact insertion verified: exact before/after anchor, intentional repetition, local preview without writes, one explicit copy preserving accepted source, pending/lost/stale/offline recovery without replay, inserted-position focus, single/31-to32 guards, last-place visibility, paused automatic formulation and reload/profile reset.",
  );
} catch (error) {
  report.status = "failed";
  if (page) {
    await fs.mkdir(".local/compact-touch-insertion", { recursive: true });
    await page.screenshot({
      path: ".local/compact-touch-insertion/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await fs.mkdir(".local/compact-touch-insertion", { recursive: true });
  await fs.writeFile(
    ".local/compact-touch-insertion/report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await admin.dispose();
}
