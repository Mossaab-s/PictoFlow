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
  await call("profiles", "POST", { display_name: "Phrases compactes fictives" })
).id;
const empty = (
  await call("profiles", "POST", { display_name: "Mémoire vide fictive" })
).id;
const foreign = (
  await call("profiles", "POST", { display_name: "Autre mémoire fictive" })
).id;
async function touch(p) {
  const base = `profiles/${p}`;
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label: "Livre",
    pictogram_key: "book",
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    confirm_representation: true,
    actor_role: "user",
  });
  await call(base + `/keyboard/${block.id}`, "PUT", {
    zone: "personal",
    position: 0,
    actor_role: "user",
  });
  return block;
}
const block = await touch(profile);
const otherBlock = await touch(foreign);
async function phrase(p, b, count, text, status = "correct", shortcut = false) {
  const base = `profiles/${p}`;
  const sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  for (let i = 0; i < count; i++)
    await call(base + `/sequences/${sequence.id}/selection`, "POST", {
      action: "append",
      block_id: b.id,
    });
  await call(base + `/sequences/${sequence.id}/selection`, "POST", {
    action: "complete",
  });
  const decision = await call(
    base + `/sequences/${sequence.id}/interpret`,
    "POST",
    {},
  );
  let item = decision.candidates[0];
  if (status)
    item = await call(base + `/interpretations/${item.id}/feedback`, "POST", {
      action: status,
      ...(status === "correct" ? { corrected_value: text } : {}),
      actor_role: "user",
    });
  if (shortcut)
    await call(base + `/phrases/${item.id}/shortcut`, "PATCH", {
      selected: true,
      expected_selected: false,
      expected_text: item.corrected_text ?? item.text,
      actor_role: "user",
    });
  return item;
}
const first = await phrase(
  profile,
  block,
  1,
  "Je veux lire mon livre.",
  "correct",
  true,
);
const second = await phrase(
  profile,
  block,
  2,
  "Encore mon livre, s’il te plaît.",
  "correct",
  true,
);
for (let i = 3; i <= 8; i++)
  await phrase(
    profile,
    block,
    i,
    `Ma phrase personnelle ${i}. ` +
      "Je choisis mon livre préféré. ".repeat(i === 3 ? 12 : 1),
  );
await phrase(profile, block, 9, "", null);
await phrase(profile, block, 10, "", "reject");
await phrase(foreign, otherBlock, 1, "Phrase privée de l’autre profil.");
const communicator = await call("auth/users", "POST", {
  username: "compact-phrases-ci",
  display_name: "Communication par phrases fictive",
  password,
});
for (const p of [profile, empty])
  await call(
    `auth/users/${communicator.id}/profiles/${p}/capabilities`,
    "PUT",
    {
      capabilities: ["communicate"],
      expected_capabilities: null,
    },
  );

const browser = await chromium.launch({ headless: true });
let page;
const report = {
  status: "running",
  viewports: [],
  writes_during_reuse: 0,
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
      req.url().includes("/api/pictoflow/profiles/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
    )
      writes.push(req.url());
    if (req.url().endsWith("/interpret")) report.model_requests++;
  });
  await page.goto(origin + "/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(communicator.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.evaluate(
    (p) => localStorage.setItem(`pictoflow:automatic:${p}`, "off"),
    profile,
  );
  await page.goto(`${origin}/communication/${profile}`);
  const surface = page.locator(".compact-communication");
  const words = surface.locator(".compact-word .touch-word");
  const book = surface
    .locator(".compact-browse")
    .getByRole("button", { name: "Livre", exact: true });
  await book.click();
  await expect(book).toBeEnabled();
  await book.click();
  await expect(words).toHaveText(["Livre", "Livre"]);
  const reference = await page.evaluate(
    (p) => sessionStorage.getItem(`pictoflow:sequence:${p}`),
    profile,
  );
  const before = {};
  for (const resource of ["sequences", "memory", "keyboard", "audit"])
    before[resource] = await call(`profiles/${profile}/${resource}`);
  const beforeWrites = writes.length;
  const trigger = surface.getByRole("button", {
    name: "Mes phrases",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Mes phrases", exact: true });
  const cards = dialog.locator(".phrase-cards article");
  const chosen = dialog.getByRole("region", {
    name: "Phrase choisie",
    exact: true,
  });
  const read = chosen.getByRole("button", {
    name: "Lire cette phrase",
    exact: true,
  });
  const back = dialog.getByRole("button", {
    name: "Revenir au message",
    exact: true,
  });
  await trigger.press("Enter");
  await expect(
    dialog.getByRole("heading", { name: "Mes phrases", exact: true }),
  ).toBeFocused();
  await expect(cards).toHaveCount(2);
  await expect(
    dialog.getByLabel("Je choisis mes raccourcis en tant que"),
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /raccourcis/ })).toHaveCount(
    1,
  );
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  const target = cards.filter({ hasText: "Encore mon livre" });
  await target.getByRole("button", { name: "Utiliser cette phrase" }).click();
  await expect(chosen.getByRole("heading")).toBeFocused();
  await expect(chosen.locator(".touch-word")).toHaveText(["Livre", "Livre"]);
  await expect(chosen.locator("svg")).toHaveCount(2);
  await read.click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    second.corrected_text,
  ]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(words).toHaveText(["Livre", "Livre"]);
  assert.equal(
    await page.evaluate(
      (p) => sessionStorage.getItem(`pictoflow:sequence:${p}`),
      profile,
    ),
    reference,
  );

  // A late correction requires a fresh review; later rejection prevents stale speech.
  await trigger.click();
  await cards
    .filter({ hasText: first.corrected_text })
    .getByRole("button", { name: "Utiliser cette phrase" })
    .click();
  await call(
    `profiles/${profile}/interpretations/${first.id}/feedback`,
    "POST",
    {
      action: "correct",
      corrected_value: "Je préfère lire avec Papa.",
      actor_role: "user",
    },
  );
  const spoken = (await page.evaluate(() => window.__spoken)).length;
  await read.click();
  await expect(chosen.locator(".memory-phrase")).toHaveText(
    "Je préfère lire avec Papa.",
  );
  await expect(dialog.getByRole("status")).toContainText(
    "Vérifiez le nouveau texte",
  );
  assert.equal((await page.evaluate(() => window.__spoken)).length, spoken);
  await read.click();
  assert.equal(
    (await page.evaluate(() => window.__spoken)).at(-1),
    "Je préfère lire avec Papa.",
  );
  await call(
    `profiles/${profile}/interpretations/${first.id}/feedback`,
    "POST",
    { action: "reject", actor_role: "user" },
  );
  await read.click();
  await expect(chosen).toHaveCount(0);
  await expect(dialog.getByRole("alert")).toContainText("a changé");
  assert.equal((await page.evaluate(() => window.__spoken)).length, spoken + 1);
  await back.click();

  // Read-only browsing, pagination, search and narrow-screen layout.
  await trigger.click();
  await dialog
    .getByRole("button", { name: "Toutes mes phrases acceptées", exact: true })
    .click();
  await expect(cards).toHaveCount(6);
  await expect(dialog.getByText("Page 1 sur 2", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Suivant", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await dialog.getByLabel("Rechercher une phrase").fill("personnelle 3");
  await expect(cards).toHaveCount(1);
  assert(
    !(await dialog.innerText()).includes("Phrase privée de l’autre profil"),
  );
  await cards.getByRole("button", { name: "Utiliser cette phrase" }).click();
  await fs.mkdir(".local/compact-personal-phrases", { recursive: true });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    const layout = await dialog.evaluate((node) => ({
      x: node.getBoundingClientRect().x,
      right: node.getBoundingClientRect().right,
      width: node.clientWidth,
      content: node.scrollWidth,
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    assert(
      layout.x >= 0 &&
        layout.right <= width &&
        layout.content <= layout.width + 1 &&
        layout.scroll <= width,
      JSON.stringify(layout),
    );
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await page.screenshot({
      path: `.local/compact-personal-phrases/accepted-${width}.png`,
    });
    report.viewports.push(width);
  }
  await back.click();
  assert((await surface.boundingBox()).width <= 320);
  await expect(words).toHaveText(["Livre", "Livre"]);

  // Closing aborts an outstanding read; its late result cannot revive a choice.
  await trigger.click();
  const readRoute = `**/api/pictoflow/profiles/${profile}/phrases/${second.id}`;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  await page.route(readRoute, async (route) => {
    const response = await route.fetch();
    requested();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await cards
    .filter({ hasText: second.corrected_text })
    .getByRole("button", { name: "Utiliser cette phrase" })
    .click();
  await started;
  await back.click();
  await expect(trigger).toBeFocused();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await trigger.click();
  await expect(cards).toHaveCount(1);
  await expect(chosen).toHaveCount(0);
  await expect(dialog.getByLabel("Rechercher une phrase")).toHaveValue("");
  await back.click();

  const memoryRoute = `**/api/pictoflow/profiles/${profile}/memory?validated=true`;
  await page.route(memoryRoute, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic read unavailable" },
    }),
  );
  await trigger.click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Le service est indisponible.",
  );
  await expect(back).toBeEnabled();
  await page.unroute(memoryRoute);
  await dialog
    .getByRole("button", { name: "Actualiser les phrases", exact: true })
    .click();
  await expect(cards).toHaveCount(1);
  await back.click();

  await page.context().setOffline(true);
  await trigger.click();
  await expect(dialog.getByRole("status")).toContainText(
    "demandent une connexion",
  );
  await back.click();
  await expect(
    surface.getByRole("button", { name: "Lire mes pictos", exact: true }),
  ).toBeEnabled();
  await page.context().setOffline(false);
  await expect(book).toBeEnabled();
  report.writes_during_reuse = writes.length - beforeWrites;
  assert.equal(report.writes_during_reuse, 0);
  assert.equal(report.model_requests, 0);
  assert.deepEqual(
    await call(`profiles/${profile}/sequences`),
    before.sequences,
  );
  assert.deepEqual(await call(`profiles/${profile}/keyboard`), before.keyboard);
  // Only the two deliberate fixture changes above may change accepted memory/audit.
  const fixtureAudit = await call(`profiles/${profile}/audit`);
  const fixtureMemory = await call(`profiles/${profile}/memory`);
  await trigger.click();
  await back.click();
  assert.deepEqual(await call(`profiles/${profile}/audit`), fixtureAudit);
  assert.deepEqual(await call(`profiles/${profile}/memory`), fixtureMemory);

  // With automatic preview enabled, browsing suspends the 1.2-second timer.
  await page.evaluate(
    (p) => localStorage.removeItem(`pictoflow:automatic:${p}`),
    profile,
  );
  await page.reload();
  await trigger.click();
  await expect(cards).toHaveCount(1);
  await page.waitForTimeout(1500);
  assert.equal(report.model_requests, 0);
  assert.equal(writes.length - beforeWrites, 0);
  await expect(words).toHaveText(["Livre", "Livre"]);
  await page.goto(`${origin}/communication/${empty}`);
  await trigger.click();
  await expect(
    dialog.getByText("Aucun raccourci choisi.", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Toutes mes phrases acceptées", exact: true })
    .click();
  await expect(
    dialog.getByText("Aucune phrase acceptée pour le moment.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Rechercher une phrase")).toHaveValue("");
  await back.click();
  await surface.getByRole("button", { name: "Options", exact: true }).click();
  await page.getByRole("button", { name: "Mes phrases", exact: true }).click();
  await expect(page.locator(".phrase-picker")).toHaveAttribute("open", "");
  await page
    .getByRole("button", { name: "Revenir à la communication", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  assert.deepEqual(errors, []);
  report.status = "passed";
  console.log(
    "Compact personal phrases: authenticated communicate-only access, explicit current-text speech, correction/rejection safeguards, draft retention, zero browsing writes/model calls, cancellation, search/pagination, profile reset, empty/offline states and 320/390/1280 reflow passed.",
  );
} catch (error) {
  report.status = "failed";
  if (page) {
    await fs.mkdir(".local/compact-personal-phrases", { recursive: true });
    await page.screenshot({
      path: ".local/compact-personal-phrases/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await fs.mkdir(".local/compact-personal-phrases", { recursive: true });
  await fs.writeFile(
    ".local/compact-personal-phrases/report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await admin.dispose();
}
