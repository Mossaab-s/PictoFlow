import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request } from "@playwright/test";

const origin = "http://127.0.0.1:3130";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const r = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(r.ok(), `${method} ${path}: ${r.status()}`);
  return r.json();
}
const browser = await chromium.launch({ headless: true });
try {
  const p = (
    await call("profiles", "post", { display_name: "Mon espace fictif" })
  ).id;
  const base = `profiles/${p}`;
  const blocks = [];
  for (const [label, key] of [
    ["Boire", "drink"],
    ["Eau", "water"],
    ["Livre", "book"],
  ]) {
    const b = await call(base + "/blocks/personal", "post", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key: key,
      actor_role: "user",
    });
    await call(base + `/blocks/${b.id}/feedback`, "post", {
      action: "confirm",
      actor_role: "user",
      confirm_representation: true,
    });
    await call(base + `/keyboard/${b.id}`, "put", {
      zone: "personal",
      position: blocks.length,
      actor_role: "user",
    });
    blocks.push(b);
  }
  const before = await call(base + "/keyboard");
  const page = await browser.newPage();
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
        cancel() {},
        speak(utterance) {
          window.__spoken.push(utterance.text);
          utterance.onstart?.();
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  let ai = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/interpret")) ai++;
  });
  await fs.mkdir(".local/ux-communication", { recursive: true });
  for (const [width, height] of [
    [1280, 800],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/communication/${p}`);
    const first = page
      .locator(".communication-keyboard .communication-tile")
      .first();
    await first.waitFor();
    assert.equal(
      await page
        .locator(".communication-suggestion-options")
        .evaluate((element) => element.open),
      false,
    );
    assert.equal(await page.locator(".memory-suggestions").isVisible(), false);
    assert.equal(
      await page.locator(".phrase-picker").evaluate((element) => element.open),
      false,
    );
    const box = await first.boundingBox();
    assert(
      box.y + box.height <= height,
      `First row must be visible at ${width}: ${JSON.stringify(box)}`,
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.local/ux-communication/layout-${width}.png`,
    });
  }
  const keyboard = page.locator(".communication-keyboard");
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await page.locator(".message-touch").first().waitFor();
  const suggestionsLink = page.locator(
    'a[aria-controls="communication-suggestion-options"]',
  );
  await suggestionsLink.focus();
  await suggestionsLink.press("Enter");
  await page
    .getByRole("group", { name: "Mode de suggestions", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Mots", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector('a[aria-controls="communication-suggestion-options"]')
        ?.getAttribute("aria-expanded") === "false",
  );
  assert(
    await suggestionsLink.evaluate(
      (element) => element === document.activeElement,
    ),
  );
  assert.equal(await page.locator(".message-touch").count(), 1);
  await suggestionsLink.click();
  await page.getByRole("button", { name: "Désactivées", exact: true }).click();
  await page
    .getByRole("button", { name: "Fermer les suggestions", exact: true })
    .click();
  assert(
    await suggestionsLink.evaluate(
      (element) => element === document.activeElement,
    ),
  );
  const phrasesEntry = page.getByRole("button", {
    name: "Mes phrases",
    exact: true,
  });
  await phrasesEntry.focus();
  await phrasesEntry.press("Enter");
  await page.locator(".phrase-picker[open]").waitFor();
  assert.equal(
    await page
      .locator(".communication-tools")
      .evaluate((element) => element.open),
    false,
  );
  await page.keyboard.press("Escape");
  assert(
    await phrasesEntry.evaluate(
      (element) => element === document.activeElement,
    ),
  );
  assert.equal(
    await page.locator(".phrase-picker").evaluate((element) => element.open),
    false,
  );
  assert.equal(await page.locator(".message-touch").count(), 1);
  await page
    .getByRole("button", { name: "Plus d’options", exact: true })
    .click();
  await page.getByText("Réglages d’affichage", { exact: true }).click();
  await page
    .getByRole("button", { name: "Revenir au clavier", exact: true })
    .click();
  assert.equal(await page.locator(".message-touch").count(), 1);
  assert(
    await page
      .getByRole("button", { name: "Plus d’options", exact: true })
      .evaluate((e) => e === document.activeElement),
  );
  for (let i = 0; i < 11; i++) {
    await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
    await page
      .locator(".message-touch")
      .nth(i + 1)
      .waitFor();
  }
  await page.setViewportSize({ width: 320, height: 800 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert(
    await page
      .locator(".message-tokens")
      .evaluate((e) => e.scrollHeight > e.clientHeight),
  );
  await page.screenshot({ path: ".local/ux-communication/long-message.png" });
  await page
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Boire" + " Eau".repeat(11),
  ]);
  await page
    .getByRole("button", { name: "Arrêter la lecture", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Effacer le message", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Garder mon message", exact: true })
    .click();
  assert.equal(await page.locator(".message-touch").count(), 12);
  await page
    .getByRole("button", { name: "Effacer le message", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Oui, effacer les mots", exact: true })
    .click();
  await page
    .getByText("Votre message apparaîtra ici.", { exact: true })
    .waitFor();
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await page.locator(".message-touch").first().waitFor();
  await page
    .getByRole("button", { name: "Nouveau message", exact: true })
    .click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".message-touch").count(), 1);
  await page
    .getByRole("button", { name: "Nouveau message", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Oui, commencer un autre message",
      exact: true,
    })
    .click();
  await page
    .getByText("Votre message apparaîtra ici.", { exact: true })
    .waitFor();
  assert.deepEqual(await call(base + "/keyboard"), before);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Plus d’options", exact: true })
    .click();
  const size = page.getByRole("radio", { name: /Très grandes touches/ });
  if (!(await size.isVisible()))
    await page.getByText("Réglages d’affichage", { exact: true }).click();
  await size.check();
  await page
    .getByRole("checkbox", { name: "Contraste renforcé", exact: true })
    .check();
  await page
    .getByText("Utiliser le clavier et la souris", { exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector('button[aria-controls="communication-options"]')
        ?.getAttribute("aria-expanded") === "false",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Plus d’options", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await page.reload();
  await keyboard.locator(".communication-tile").first().waitFor();
  await page
    .getByRole("button", { name: "Plus d’options", exact: true })
    .click();
  await page.getByText("Réglages d’affichage", { exact: true }).click();
  assert(await size.isChecked());
  assert(
    await page
      .getByRole("checkbox", { name: "Contraste renforcé", exact: true })
      .isChecked(),
  );
  await page
    .getByRole("button", { name: "Revenir au clavier", exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 800 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.keyboard.press("Tab");
  await keyboard.getByRole("button", { name: "Boire", exact: true }).focus();
  assert(
    await keyboard
      .getByRole("button", { name: "Boire", exact: true })
      .evaluate((e) => getComputedStyle(e).outlineStyle !== "none"),
  );
  await page.screenshot({
    path: ".local/ux-communication/large-forced-colors.png",
  });
  await page.emulateMedia({ forcedColors: "none" });
  const sequenceCount = (await call(base + "/sequences")).length;
  await call(base + "/keyboard-groups", "post", {
    label: "Activités",
    actor_role: "user",
  });
  await page.goto(`${origin}/admin/profiles/${p}/keyboard`);
  await page.getByRole("link", { name: "Voir l’aperçu", exact: true }).click();
  const preview = page.getByRole("region", {
    name: "Aperçu du clavier de communication",
    exact: true,
  });
  await preview.locator(".tile-preview").first().waitFor();
  assert.equal(await preview.locator(".tile-preview").count(), 3);
  assert.equal(await preview.locator("button.communication-tile").count(), 0);
  assert((await preview.locator(".grid-columns-2").count()) > 0);
  await preview.getByRole("button", { name: "Activités", exact: true }).click();
  await preview
    .getByText("Cette page attend ses touches.", { exact: false })
    .waitFor();
  await preview.getByRole("button", { name: "Accueil", exact: true }).click();
  assert(
    await preview
      .locator(".touch-word")
      .evaluateAll((nodes) =>
        nodes.every(
          (e) =>
            e.getBoundingClientRect().right <=
            e.parentElement.getBoundingClientRect().right,
        ),
      ),
  );
  await page.screenshot({
    path: ".local/ux-communication/preparation-preview.png",
  });
  assert.equal((await call(base + "/sequences")).length, sequenceCount);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await page.goto(`${origin}/communication/${p}`);
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await page.locator(".message-touch").first().waitFor();
  const reference = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    `pictoflow:sequence:${p}`,
  );
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST") writes++;
  });
  await page.context().setOffline(true);
  await page
    .getByText("Connexion réseau interrompue", { exact: true })
    .waitFor();
  assert(
    await keyboard
      .getByRole("button", { name: "Boire", exact: true })
      .isDisabled(),
  );
  await page
    .getByRole("button", { name: "Parler : lire mes mots", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), ["Boire"]);
  await page.keyboard.press("Escape");
  const beforeReconnect = writes;
  await page.context().setOffline(false);
  await page
    .getByText("Connexion réseau interrompue", { exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(writes, beforeReconnect);
  const selectionPath = `**/profiles/${p}/sequences/${reference.sequence_id}/selection`;
  const restorePath = `**/profiles/${p}/sequences/${reference.sequence_id}`;
  await page.route(selectionPath, (r) =>
    r.fulfill({ status: 503, json: { detail: "Synthetic failure" } }),
  );
  await page.route(restorePath, (r) =>
    r.fulfill({ status: 503, json: { detail: "Synthetic recovery failure" } }),
  );
  await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
  await page
    .getByRole("button", { name: "Recharger le message", exact: true })
    .waitFor();
  assert(
    await keyboard
      .getByRole("button", { name: "Boire", exact: true })
      .isDisabled(),
  );
  assert.equal(await page.locator(".message-touch").count(), 1);
  await page.unroute(selectionPath);
  await page
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  await page.locator(".communication-memory").waitFor();
  assert.equal(await page.locator(".composition-memory").isVisible(), false);
  assert(await page.locator(".interpretation-panel").isVisible());
  assert(
    await page
      .locator(".interpretation-panel")
      .evaluate(
        (element) =>
          !!(
            element.compareDocumentPosition(
              document.querySelector(".communication-memory"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
  );
  assert.equal(
    await page
      .getByLabel("Contexte que je souhaite préciser, facultatif", {
        exact: true,
      })
      .isVisible(),
    false,
  );
  await page.getByText("Ce que ma mémoire retient", { exact: true }).click();
  await page
    .getByRole("region", { name: "Mon PCL et ce message", exact: true })
    .getByText("Aucun message déjà accepté", { exact: false })
    .waitFor();
  await page.getByText("Ce que ma mémoire retient", { exact: true }).click();
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await page.unroute(restorePath);
  await page
    .getByRole("button", { name: "Recharger le message", exact: true })
    .click();
  await page.locator(".message-touch").first().waitFor();
  assert.deepEqual(
    (await call(base + `/sequences/${reference.sequence_id}`)).block_ids,
    [blocks[0].id],
  );
  let release;
  let started;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const arrived = new Promise((resolve) => {
    started = resolve;
  });
  await page.route(selectionPath, async (r) => {
    started();
    await held;
    await r.continue();
  });
  await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
  await arrived;
  const optionsButton = page.getByRole("button", {
    name: "Plus d’options",
    exact: true,
  });
  await optionsButton.focus();
  release();
  await page.locator(".message-touch").nth(1).waitFor();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert(
    await optionsButton.evaluate((e) => document.activeElement === e),
    "Late response must not reclaim focus",
  );
  await page.unroute(selectionPath);
  // A mocked authenticated frontend session checks layout and affordances, not API security.
  await page.route("**/api/pictoflow/auth/session", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        csrf_token: "synthetic-ux-token",
        account: {
          id: crypto.randomUUID(),
          username: "synthetic",
          display_name: "Compte fictif",
          is_admin: false,
          active: true,
          profile_access: { [p]: "communicator" },
        },
      },
    }),
  );
  await page.evaluate((profile) => {
    localStorage.setItem(
      `pictoflow:display:${profile}`,
      JSON.stringify({ version: 1, size: "standard" }),
    );
    sessionStorage.removeItem(`pictoflow:sequence:${profile}`);
  }, p);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await keyboard.locator(".communication-tile").first().waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Il me manque un mot", exact: true })
      .count(),
    0,
  );
  const firstRow = await keyboard
    .locator(".communication-tile")
    .first()
    .boundingBox();
  await page.screenshot({
    path: ".local/ux-communication/account-first-row.png",
  });
  assert(
    firstRow.y + firstRow.height <= 844,
    `Account controls must not bury the keyboard: ${JSON.stringify(firstRow)}`,
  );
  await page.getByText("Mon compte", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Se déconnecter et effacer les copies locales",
      exact: true,
    })
    .waitFor();
  await page.getByText("Mon compte", { exact: true }).click();
  await page.getByRole("button", { name: "Mes phrases", exact: true }).click();
  await page.locator(".phrase-library > details.phrase-picker[open]").waitFor();
  assert.equal(
    await page
      .locator(".phrase-library > details.phrase-picker > summary")
      .evaluate((element) => document.activeElement === element),
    true,
    "The header entry must expand the usual-phrase list and focus its summary",
  );
  await page.keyboard.press("Escape");
  assert(
    await page
      .getByRole("button", { name: "Mes phrases", exact: true })
      .evaluate((e) => document.activeElement === e),
  );
  await page.screenshot({
    path: ".local/ux-communication/communicator-account-mobile.png",
  });
  await page.goto(`${origin}/admin/profiles/${p}/keyboard`);
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(await call(base + "/keyboard"), before);
  assert.equal(ai, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Communication-first layout verified at desktop, tablet and mobile sizes; bounded long message; options preserve draft and saved placements; no AI or acceptance.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
