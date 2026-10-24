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
    display_name: "Correction compacte fictive",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre correction fictive" })
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
  username: "compact-touch-replacement-ci",
  display_name: "Correction communicante fictive",
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
          },
        ],
        speak(u) {
          window.__spoken.push(u.text);
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
  const keepChoice = chooser.getByRole("button", {
    name: "Garder cette touche",
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
  const review = dialog.getByRole("heading", {
    name: "Vérifier le remplacement",
    exact: true,
  });
  async function choose(label, ordinal, total, replacement) {
    await occurrence(label, ordinal, total).press("Enter");
    await expect(keepChoice).toBeFocused();
    await chooser
      .getByRole("button", { name: "Remplacer cette touche", exact: true })
      .click();
    await expect(keep).toBeFocused();
    if (replacement) {
      await picker
        .getByRole("button", { name: replacement, exact: true })
        .click();
      await expect(review).toBeFocused();
    }
  }
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await expect(surface.locator(".proposed-phrase")).toHaveText(
    decision.candidates[0].text,
  );
  await occurrence("Eau", 2, 4).click();
  await expect(keepChoice).toBeFocused();
  await keepChoice.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(occurrence("Eau", 2, 4)).toBeFocused();
  await choose("Eau", 2, 4, "Eau");
  await expect(confirm).toBeDisabled();
  await another.click();
  await picker
    .getByRole("button", { name: "Retrouver une touche", exact: true })
    .click();
  const input = picker.getByLabel("Chercher le mot de ma touche", {
    exact: true,
  });
  await input.fill("livre");
  const result = picker.getByRole("button", {
    name: "Choisir « Livre » pour le remplacement",
    exact: true,
  });
  await result.press("Enter");
  await expect(review).toBeFocused();
  await expect(
    dialog.locator(".replacement-comparison .touch-word"),
  ).toHaveText(["Eau", "Livre"]);
  await expect(dialog.locator(".replacement-comparison svg")).toHaveCount(2);
  await another.click();
  await expect(result).toBeFocused();
  await expect(input).toHaveValue("livre");
  await result.click();
  await fs.mkdir(".local/compact-touch-replacement", { recursive: true });
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
      path: `.local/compact-touch-replacement/review-${width}.png`,
    });
    report.viewports.push(width);
  }
  await keep.click();
  await expect(occurrence("Eau", 2, 4)).toBeFocused();
  report.preview_writes = writes.length;
  assert.equal(report.preview_writes, 0);
  assert.equal((await call(base + "/sequences")).length, 1);

  // Explicit replacement of accepted snapshot creates exactly one independent copy.
  await choose("Eau", 2, 4, "Livre");
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
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await confirm.evaluate((node) => node.click());
  release();
  const copy = await (await copied).json();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Livre", "Livre", "Eau"]);
  await expect(occurrence("Livre", 2, 4)).toBeFocused();
  await page.unroute(copyURL);
  assert.notEqual(copy.id, source.id);
  assert.equal(report.copies, 1);
  assert.equal(pending, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, {
    action: "replace",
    index: 1,
    expected_block_ids: originalIds,
    block_id: book.id,
  });
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(await call(base + "/memory"), before.memory);
  const copyPath = base + `/sequences/${copy.id}`;
  assert.deepEqual((await call(copyPath)).block_ids, [
    mother.id,
    book.id,
    book.id,
    water.id,
  ]);
  await expect(surface.locator(".proposed-phrase")).toHaveText(
    "Maman Livre Livre Eau",
  );

  // A committed replacement with a lost response is reread once, never replayed.
  await choose("Eau", 4, 4, "Maman");
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
  await expect(words).toHaveText(["Maman", "Livre", "Livre", "Maman"]);
  await expect(occurrence("Maman", 4, 4)).toBeFocused();
  assert.equal(uncertain, 1);
  assert.equal(report.copies, 1);
  await page.unroute(selectionURL);

  // Another session changes the draft; snapshot conflict must not overwrite it.
  await choose("Livre", 2, 4, "Eau");
  await call(copyPath + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${copyPath}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Livre", "Livre"]);
  await expect(surface.getByRole("status")).toContainText(
    "Votre remplacement n’a pas été appliqué",
  );
  await expect(occurrence("Livre", 2, 3)).toBeFocused();
  await choose("Livre", 2, 3, "Eau");
  const offlineWrites = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await keep.click();
  await expect(dialog).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(occurrence("Livre", 2, 3)).toBeEnabled();
  assert.equal(writes.length, offlineWrites);

  // Existing compact removal still edits only the selected occurrence.
  await occurrence("Livre", 2, 3).click();
  await chooser
    .getByRole("button", { name: "Retirer cette touche", exact: true })
    .click();
  await expect(chooser).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Livre"]);
  await expect(occurrence("Livre", 2, 2)).toBeFocused();
  assert.deepEqual((await call(copyPath)).block_ids, [mother.id, book.id]);

  // At 32 touches, replacements remain available although appending is disabled.
  const fullIds = [...Array(31).fill(water.id), book.id];
  const full = await draft(fullIds);
  await page.evaluate(
    ({ profile, id }) =>
      sessionStorage.setItem(
        `pictoflow:sequence:${profile}`,
        JSON.stringify({ sequence_id: id }),
      ),
    { profile, id: full.id },
  );
  await page.reload();
  await expect(words).toHaveCount(32);
  await expect(
    surface
      .locator(".compact-browse")
      .getByRole("button", { name: "Livre", exact: true }),
  ).toBeDisabled();
  await choose("Eau", 31, 32, "Maman");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(occurrence("Maman", 31, 32)).toBeFocused();
  const finalIds = [...Array(30).fill(water.id), mother.id, book.id];
  assert.deepEqual(
    (await call(base + `/sequences/${full.id}`)).block_ids,
    finalIds,
  );
  assert.equal(report.copies, 1);

  // Opening a preview suspends automatic formulation without a write or copy.
  await page.evaluate(
    (p) => localStorage.removeItem(`pictoflow:automatic:${p}`),
    profile,
  );
  await page.reload();
  const pauseWrites = writes.length;
  await choose("Livre", 32, 32, "Eau");
  await page.waitForTimeout(1500);
  assert.equal(writes.length, pauseWrites);
  assert.equal(report.model_requests, 0);
  await page.goto(`${origin}/communication/${other}`);
  await expect(dialog).toHaveCount(0);
  await expect(chooser).toHaveCount(0);
  await expect(words).toHaveCount(0);
  await page.evaluate(
    (p) => localStorage.setItem(`pictoflow:automatic:${p}`, "off"),
    profile,
  );
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(32);
  await expect(dialog).toHaveCount(0);
  assert.equal(writes.length, pauseWrites);
  for (const resource of ["memory", "keyboard", "blocks", "representations"])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  assert.equal(report.model_requests, 0);
  assert.deepEqual(errors, []);
  report.status = "passed";
  console.log(
    "Compact exact-occurrence replacement verified: local review without writes, accepted snapshot preserved through one explicit copy, pending lock, lost/stale response recovery without replay, offline cancellation, removal, 32-touch replacement, paused automatic formulation, focus and profile/reload reset.",
  );
} catch (error) {
  report.status = "failed";
  if (page) {
    await fs.mkdir(".local/compact-touch-replacement", { recursive: true });
    await page.screenshot({
      path: ".local/compact-touch-replacement/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await fs.mkdir(".local/compact-touch-replacement", { recursive: true });
  await fs.writeFile(
    ".local/compact-touch-replacement/report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await admin.dispose();
}
