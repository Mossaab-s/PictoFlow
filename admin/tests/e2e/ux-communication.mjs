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
  assert.equal(ai, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Communication-first layout verified at desktop, tablet and mobile sizes; bounded long message; options preserve draft and saved placements; no AI or acceptance.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
