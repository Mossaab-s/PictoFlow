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
    display_name: "Ordre compact fictif",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre ordre fictif" })
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
  username: "compact-touch-order-ci",
  display_name: "Ordre communicant fictif",
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
  const move = chooser.getByRole("button", {
    name: "Déplacer cette touche",
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
  async function choose(label, ordinal, total) {
    await occurrence(label, ordinal, total).press("Enter");
    await expect(
      chooser.getByRole("button", { name: "Garder cette touche", exact: true }),
    ).toBeFocused();
    await move.click();
    await expect(keep).toBeFocused();
    await expect(confirm).toBeDisabled();
  }
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await choose("Maman", 1, 4);
  await expect(preview.locator(".touch-word")).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
  ]);
  await dialog
    .getByRole("button", { name: "Une place après →", exact: true })
    .click();
  await expect(place).toHaveValue("1");
  await expect(preview.locator(".touch-word")).toHaveText([
    "Eau",
    "Maman",
    "Livre",
    "Eau",
  ]);
  await place.selectOption("2");
  await expect(preview.locator(".touch-word")).toHaveText([
    "Eau",
    "Livre",
    "Maman",
    "Eau",
  ]);
  await expect(preview.locator("svg")).toHaveCount(4);
  await expect(preview.locator('[aria-current="step"] .touch-word')).toHaveText(
    "Maman",
  );
  await fs.mkdir(".local/compact-touch-order", { recursive: true });
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
      path: `.local/compact-touch-order/review-${width}.png`,
    });
    report.viewports.push(width);
  }
  await keep.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(occurrence("Maman", 1, 4)).toBeFocused();
  report.preview_writes = writes.length;
  assert.equal(report.preview_writes, 0);
  assert.equal((await call(base + "/sequences")).length, 1);

  // Confirmation creates one copy; the move's focus follows its final destination.
  await choose("Maman", 1, 4);
  await place.selectOption("2");
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
  await expect(place).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Déplacement en cours…");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await confirm.evaluate((node) => node.click());
  release();
  const copy = await (await copied).json();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Eau", "Livre", "Maman", "Eau"]);
  await expect(occurrence("Maman", 3, 4)).toBeFocused();
  await page.unroute(copyURL);
  assert.notEqual(copy.id, source.id);
  assert.equal(report.copies, 1);
  assert.equal(pending, 1);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].body, {
    action: "move",
    index: 0,
    expected_block_ids: originalIds,
    target_index: 2,
  });
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(await call(base + "/memory"), before.memory);
  const copyPath = base + `/sequences/${copy.id}`;
  assert.deepEqual((await call(copyPath)).block_ids, [
    water.id,
    book.id,
    mother.id,
    water.id,
  ]);

  // A committed move with an uncertain response is recovered without a second POST.
  await choose("Maman", 3, 4);
  await place.selectOption("0");
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
  await expect(words).toHaveText(["Maman", "Eau", "Livre", "Eau"]);
  await expect(occurrence("Maman", 1, 4)).toBeFocused();
  assert.equal(uncertain, 1);
  assert.equal(report.copies, 1);
  await page.unroute(selectionURL);

  await choose("Livre", 3, 4);
  await place.selectOption("0");
  await call(copyPath + "/selection", "POST", { action: "undo" });
  const conflict = page.waitForResponse(
    (r) => r.url().endsWith(`/${copyPath}/selection`) && r.status() === 409,
  );
  await confirm.click();
  await conflict;
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveText(["Maman", "Eau", "Livre"]);
  await expect(surface.getByRole("status")).toContainText(
    "Votre déplacement n’a pas été appliqué",
  );
  await expect(occurrence("Maman", 1, 3)).toBeFocused();
  await choose("Eau", 2, 3);
  await place.selectOption("0");
  const offlineWrites = writes.length;
  await page.context().setOffline(true);
  await expect(confirm).toBeDisabled();
  await expect(place).toBeDisabled();
  await keep.click();
  await expect(dialog).toHaveCount(0);
  await page.context().setOffline(false);
  await expect(occurrence("Eau", 2, 3)).toBeEnabled();
  assert.equal(writes.length, offlineWrites);

  // A single occurrence offers Keep/Remove/Replace but cannot be moved.
  const single = await draft([mother.id]);
  await page.evaluate(
    ({ profile, id }) =>
      sessionStorage.setItem(
        `pictoflow:sequence:${profile}`,
        JSON.stringify({ sequence_id: id }),
      ),
    { profile, id: single.id },
  );
  await page.reload();
  await expect(words).toHaveText(["Maman"]);
  await occurrence("Maman", 1, 1).click();
  await expect(move).toBeDisabled();
  await expect(
    chooser.getByRole("button", {
      name: "Remplacer cette touche",
      exact: true,
    }),
  ).toBeEnabled();
  await chooser
    .getByRole("button", { name: "Garder cette touche", exact: true })
    .click();
  await expect(occurrence("Maman", 1, 1)).toBeFocused();

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
  const unchangedWrites = writes.length;
  await choose("Eau", 1, 32);
  await place.selectOption("1");
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText(
    "L’ordre reste inchangé.",
  );
  await keep.click();
  assert.equal(writes.length, unchangedWrites);
  await choose("Livre", 32, 32);
  await expect(preview.locator('[aria-current="step"]')).toBeInViewport();
  assert(await preview.evaluate((node) => node.scrollTop > 0));
  await place.selectOption("0");
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(words).toHaveCount(32);
  await expect(occurrence("Livre", 1, 32)).toBeFocused();
  assert.deepEqual((await call(base + `/sequences/${full.id}`)).block_ids, [
    book.id,
    ...Array(31).fill(water.id),
  ]);
  assert.equal(report.copies, 1);

  // Preview pauses the automatic scheduling delay, including at the last place.
  await page.evaluate(
    (p) => localStorage.removeItem(`pictoflow:automatic:${p}`),
    profile,
  );
  await page.reload();
  const pauseWrites = writes.length;
  await choose("Livre", 1, 32);
  await place.selectOption("31");
  await expect(preview.locator('[aria-current="step"]')).toBeInViewport();
  await dialog.screenshot({
    path: ".local/compact-touch-order/last-place-320.png",
  });
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
    "Compact exact-occurrence move verified: local numbered preview without writes, one explicit copy preserving accepted original, destination focus, pending lock, lost/stale recovery without replay, offline cancellation, single/full message guards, identical-repeat no-op, last-place visibility, automatic-preview pause and profile/reload reset.",
  );
} catch (error) {
  report.status = "failed";
  if (page) {
    await fs.mkdir(".local/compact-touch-order", { recursive: true });
    await page.screenshot({
      path: ".local/compact-touch-order/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await fs.mkdir(".local/compact-touch-order", { recursive: true });
  await fs.writeFile(
    ".local/compact-touch-order/report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await admin.dispose();
}
