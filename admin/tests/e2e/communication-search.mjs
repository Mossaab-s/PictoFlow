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
    display_name: "Recherche personnelle fictive",
  })
).id;
const second = (
  await call("profiles", "POST", { display_name: "Autre recherche fictive" })
).id;
const base = `profiles/${profile}`;
const needs = await call(base + "/keyboard-groups", "POST", {
  label: "Besoins",
  actor_role: "user",
});
const outings = await call(base + "/keyboard-groups", "POST", {
  label: "Sorties",
  actor_role: "user",
});
async function touch(
  p,
  label,
  key,
  position,
  group_id = null,
  zone = "personal",
  meaning = label,
) {
  const prefix = `profiles/${p}`;
  const block = await call(prefix + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    meaning,
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
await touch(profile, "Maman", "mother", 0, null, "stable");
const water = await touch(
  profile,
  "Eau",
  "water",
  2,
  needs.id,
  "personal",
  "Mon verre pour boire",
);
const pool = await touch(
  profile,
  "Eau",
  "water",
  4,
  outings.id,
  "personal",
  "L’eau de ma piscine",
);
const book = await touch(profile, "Livre", "book", 0);
const heart = await touch(profile, "Cœur", "love", 1);
for (let i = 1; i <= 5; i++)
  await touch(profile, `Mon mot numéro ${i}`, "toy", i + 3);
await call(base + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Eau proposée",
  pictogram_key: "water",
  actor_role: "user",
});
await touch(second, "Autre profil", "car", 0);
const communicator = await call("auth/users", "POST", {
  username: "communication-search-ci",
  display_name: "Communication fictive",
  password,
});
for (const p of [profile, second])
  await call(
    `auth/users/${communicator.id}/profiles/${p}/capabilities`,
    "PUT",
    { capabilities: ["communicate"], expected_capabilities: null },
  );
const before = {};
for (const resource of [
  "keyboard",
  "blocks",
  "concepts",
  "representations",
  "memory",
  "audit",
])
  before[resource] = await call(base + "/" + resource);
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__stops = 0;
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
        cancel() {
          window.__stops++;
        },
        speak(utterance) {
          window.__spoken.push(utterance.text);
          utterance.onstart?.();
        },
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
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill(communicator.username);
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
  await page.goto(`${origin}/communication/${profile}`);
  const keyboard = page.getByRole("region", {
    name: "Mon clavier de communication",
    exact: true,
  });
  const regular = keyboard.locator(".keyboard-zones");
  const pages = regular.getByRole("navigation", {
    name: "Pages du clavier",
    exact: true,
  });
  await pages.getByRole("button", { name: "Sorties", exact: true }).click();
  await regular
    .getByRole("button", {
      name: "Touches suivantes : Mes touches",
      exact: true,
    })
    .click();
  await expect(
    regular.getByRole("button", { name: "Eau", exact: true }),
  ).toBeVisible();
  const opener = keyboard.getByRole("button", {
    name: "Retrouver une touche",
    exact: true,
  });
  const panel = keyboard.getByRole("region", {
    name: "Retrouver une touche",
    exact: true,
  });
  const input = panel.getByLabel("Chercher le mot de ma touche", {
    exact: true,
  });
  const results = panel.getByRole("group", {
    name: "Touches trouvées",
    exact: true,
  });
  const message = page.getByRole("region", {
    name: "Message en cours",
    exact: true,
  });
  const words = message.locator(".message-touch .touch-word");
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.press("Enter");
  await expect(input).toBeFocused();
  await expect(results).toHaveCount(0);
  await input.fill(" EAU ");
  await input.press("Enter"); // Typing is not an implicit selection.
  await expect(panel.getByRole("status")).toHaveText("2 touches trouvées");
  const waterNeeds = results
    .getByRole("button", { name: "Ajouter « Eau » au message", exact: true })
    .filter({ hasText: "Besoins · Mes touches · place 3" });
  const waterPool = results
    .getByRole("button", { name: "Ajouter « Eau » au message", exact: true })
    .filter({ hasText: "Sorties · Mes touches · place 5" });
  await expect(waterNeeds).toBeVisible();
  await expect(waterPool).toBeVisible();
  assert.equal(await results.locator("svg.pictogram").count(), 2);
  await input.fill("coeur");
  await expect(
    results.getByRole("button", {
      name: "Ajouter « Cœur » au message",
      exact: true,
    }),
  ).toBeVisible();
  await input.fill("mot");
  await expect(results.getByRole("button")).toHaveCount(4);
  await panel
    .getByRole("button", { name: "Résultats suivants", exact: true })
    .click();
  await expect(results.getByRole("button")).toHaveCount(1);
  const previous = panel.getByRole("button", {
    name: "Résultats précédents",
    exact: true,
  });
  await expect(previous).toBeFocused();
  await input.fill("NUMERO 5");
  await expect(
    results.getByRole("button", {
      name: "Ajouter « Mon mot numéro 5 » au message",
      exact: true,
    }),
  ).toBeVisible();
  await input.fill("aucun-mot-unique-recherche95");
  await expect(panel.getByRole("status")).toHaveText("Aucune touche trouvée.");
  assert.equal(writes.length, 0);
  assert.deepEqual(await call(base + "/audit"), before.audit);
  assert.deepEqual(await call(base + "/sequences"), []);
  const storedValues = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => storage.getItem(key)),
    ),
  );
  assert(
    !storedValues.some((value) =>
      value?.includes("aucun-mot-unique-recherche95"),
    ),
  );
  assert(!page.url().includes("recherche95"));
  await panel
    .getByRole("button", { name: "Effacer la recherche", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(
    pages.getByRole("button", { name: "Sorties", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(regular.getByText("Page 2 / 2", { exact: true })).toBeVisible();
  await opener.click();
  await expect(input).toHaveValue("");
  await input.fill("eau");
  await fs.mkdir(".local/communication-search", { recursive: true });
  await panel.screenshot({
    path: ".local/communication-search/duplicate-words-desktop.png",
  });
  await waterNeeds.press("Enter");
  await expect(words).toHaveText(["Eau"]);
  await expect(waterNeeds).toBeEnabled();
  await expect(waterNeeds).toBeFocused();
  await waterNeeds.press("Enter");
  await expect(words).toHaveText(["Eau", "Eau"]);
  await waterPool.click();
  await expect(words).toHaveText(["Eau", "Eau", "Eau"]);
  const sequences = await call(base + "/sequences");
  assert.equal(sequences.length, 1);
  const sequenceId = sequences[0].id;
  assert.deepEqual(sequences[0].block_ids, [water.id, water.id, pool.id]);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await message
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toBeVisible();
  const stops = await page.evaluate(() => window.__stops);
  await input.focus();
  await input.press("Escape");
  await expect(panel).toBeVisible();
  await expect(input).toHaveValue("eau");
  await expect(
    page.getByRole("button", { name: "Arrêter la lecture", exact: true }),
  ).toHaveCount(0);
  assert((await page.evaluate(() => window.__stops)) > stops);
  await input.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
  assert.deepEqual(await page.evaluate(() => window.__spoken), ["Eau Eau Eau"]);

  await opener.click();
  await input.fill("livre");
  const bookButton = results.getByRole("button", {
    name: "Ajouter « Livre » au message",
    exact: true,
  });
  const selectionURL = `**/api/pictoflow/${base}/sequences/${sequenceId}/selection`;
  let uncertainPosts = 0;
  await page.route(selectionURL, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    uncertainPosts++;
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await bookButton.click();
  await expect(page.locator('.error[role="alert"]')).toBeVisible();
  await expect(words).toHaveCount(4);
  await expect(bookButton).toBeEnabled();
  assert.equal(uncertainPosts, 1);
  assert.deepEqual((await call(base + `/sequences/${sequenceId}`)).block_ids, [
    water.id,
    water.id,
    pool.id,
    book.id,
  ]);
  await page.unroute(selectionURL);

  await input.fill("coeur");
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
  await results
    .getByRole("button", { name: "Ajouter « Cœur » au message", exact: true })
    .click();
  await expect.poll(() => pending).toBe(1);
  await input.focus();
  release();
  await expect(words).toHaveCount(5);
  await expect(input).toBeFocused(); // A delayed selection must not steal moved focus.
  assert.equal(
    (await call(base + `/sequences/${sequenceId}`)).block_ids.at(-1),
    heart.id,
  );
  await page.unroute(selectionURL);
  await input.fill("eau");
  const beforeOffline = writes.length;
  await page.context().setOffline(true);
  await expect(waterNeeds).toBeDisabled();
  await input.fill("livre");
  await expect(bookButton).toBeDisabled();
  await page.context().setOffline(false);
  await expect(bookButton).toBeEnabled();
  assert.equal(writes.length, beforeOffline);
  await page.setViewportSize({ width: 320, height: 844 });
  await input.fill("eau");
  await panel.screenshot({
    path: ".local/communication-search/results-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await input.fill("livre");
  for (let count = 5; count < 32; count++) {
    await bookButton.click();
    await expect(words).toHaveCount(count + 1);
  }
  await expect(bookButton).toBeDisabled();
  await input.fill("eau");
  await expect(waterNeeds).toBeDisabled();
  await expect(waterPool).toBeDisabled();
  assert.equal(
    (await call(base + `/sequences/${sequenceId}`)).block_ids.length,
    32,
  );
  await message
    .getByRole("button", { name: "Annuler la dernière touche", exact: true })
    .click();
  await expect(words).toHaveCount(31);
  await expect(waterNeeds).toBeEnabled();
  await message
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  await expect(
    message.getByRole("heading", { name: "Mon message terminé", exact: true }),
  ).toBeVisible();
  await expect(waterNeeds).toBeDisabled();
  await input.fill("livre");
  await expect(bookButton).toBeDisabled();
  for (const resource of [
    "keyboard",
    "blocks",
    "concepts",
    "representations",
    "memory",
  ])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  const beforeSwitch = writes.length;
  await input.fill("recherche-privee-premier-profil");
  await page.goto(`${origin}/communication/${second}`);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.click();
  await expect(input).toHaveValue("");
  await input.fill("autre");
  await expect(results.locator(".touch-word")).toHaveText(["Autre profil"]);
  assert.deepEqual(await call(`profiles/${second}/sequences`), []);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(words).toHaveCount(31);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.click();
  await expect(input).toHaveValue("");
  assert.equal(writes.length, beforeSwitch);
  for (const req of writes.filter((req) => req.url().endsWith("/selection"))) {
    const body = req.postDataJSON();
    if (body.action === "append")
      assert.deepEqual(Object.keys(body).sort(), ["action", "block_id"]);
  }
  assert.equal(modelCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Authenticated communication lookup verified: own validated words, duplicate labels by location, accent search, pagination without writes, retained keyboard page, ordered repetitions, deliberate speech and Escape priority, uncertain selection recovery without replay, focus preservation, offline/completed/32-touch guards, profile reset, unchanged memory and mobile layout.",
  );
} catch (error) {
  if (page) {
    await fs.mkdir(".local/communication-search", { recursive: true });
    await page.screenshot({
      path: ".local/communication-search/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
