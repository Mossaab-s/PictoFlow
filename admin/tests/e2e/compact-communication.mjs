import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";

const origin = "http://127.0.0.1:3131";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const r = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(r.ok(), `${path}: ${r.status()}`);
  return r.json();
}
const browser = await chromium.launch({ headless: true });
let page;
try {
  const p = (
    await call("profiles", "post", {
      display_name: "Communication compacte fictive",
    })
  ).id;
  const base = `profiles/${p}`;
  const entries = [
    ["Oui", "yes"],
    ["Non", "no"],
    ["Stop", "stop"],
    ["Aide", "help"],
    ["Boire", "drink"],
    ["Toilettes", "toilets"],
    ["Eau", "water"],
    ["Pain", "bread"],
  ];
  for (const [index, [label, key]] of entries.entries()) {
    const block = await call(base + "/blocks/personal", "post", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key: key,
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, "post", {
      action: "confirm",
      confirm_representation: true,
      actor_role: "user",
    });
    await call(base + `/keyboard/${block.id}`, "put", {
      zone: index < 6 ? "stable" : "personal",
      position: index < 6 ? index : index - 6,
      actor_role: "user",
    });
  }
  for (let i = 0; i < 14; i++) {
    const block = await call(base + "/blocks/personal", "post", {
      request_id: crypto.randomUUID(),
      label: `Livre ${i + 1}`,
      pictogram_key: "book",
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, "post", {
      action: "confirm",
      confirm_representation: true,
      actor_role: "user",
    });
  }
  const positions = await call(base + "/keyboard");
  assert((await api.post("http://127.0.0.1:8001/_synthetic/automatic")).ok());
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
            voiceURI: "fake-fr",
            name: "Synthetic voice",
            lang: "fr-FR",
            localService: true,
            default: true,
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
  await page.goto(`${origin}/communication/${p}`);
  const surface = page.locator(".compact-communication");
  await surface.waitFor();
  const stable = surface.locator(".compact-stable");
  await expect(stable.getByRole("button")).toHaveCount(6);
  const bounds = () =>
    stable.getByRole("button").evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
  const before = await bounds();
  await stable.getByRole("button", { name: "Boire", exact: true }).click();
  await expect(surface.locator(".proposed-phrase")).toHaveText("Boire");
  await expect(
    surface
      .locator(".compact-browse")
      .getByRole("button", { name: "Eau", exact: true }),
  ).toBeEnabled();
  await surface
    .locator(".compact-browse")
    .getByRole("button", { name: "Eau", exact: true })
    .press("Enter");
  const phrase = surface.locator(".proposed-phrase");
  await expect(phrase).toHaveText("Boire Eau");
  const automaticRequests = async () =>
    (await (await api.get("http://127.0.0.1:8001/_synthetic/automatic")).json())
      .requests;
  await expect.poll(async () => (await automaticRequests()).length).toBe(1);
  await expect(
    surface
      .locator(".compact-browse")
      .getByRole("button", { name: "Eau", exact: true }),
  ).toBeFocused();
  const old = JSON.parse(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `pictoflow:sequence:${p}`,
    ),
  ).sequence_id;
  await expect(
    stable.getByRole("button", { name: "Stop", exact: true }),
  ).toBeEnabled();
  await surface
    .locator(".compact-browse")
    .getByRole("button", { name: "Pain", exact: true })
    .click();
  await expect(phrase).toHaveText("Boire Eau Pain");
  await page.evaluate(() => {
    window.__displayed = [];
    new MutationObserver(() =>
      window.__displayed.push(
        document.querySelector(".compact-formulation .proposed-phrase")
          ?.textContent,
      ),
    ).observe(document.querySelector(".compact-formulation"), {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await expect(phrase).toHaveText("Boire Eau Pain.", { timeout: 20000 });
  assert(
    !(await page.evaluate(() => window.__displayed)).includes("Boire Eau."),
  );
  assert.equal((await automaticRequests()).length, 2);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  assert.deepEqual(await bounds(), before);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const initial = await bounds();
    await surface.locator(".compact-browse").evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    assert.deepEqual(await bounds(), initial);
    await expect(
      surface.getByRole("button", { name: "Parler", exact: true }),
    ).toBeInViewport();
    await expect(
      surface.getByRole("button", { name: "C’est ça", exact: true }),
    ).toBeInViewport();
  }
  await fs.mkdir(".local/compact-communication", { recursive: true });
  await page.screenshot({
    path: ".local/compact-communication/mobile.png",
    fullPage: true,
  });
  await surface
    .getByRole("button", { name: "Lire mes pictos", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Boire Eau Pain",
  ]);
  await page.keyboard.press("Escape");
  await surface.getByRole("button", { name: "Parler", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Boire Eau Pain",
    "Boire Eau Pain.",
  ]);
  await page.keyboard.press("Escape");
  await surface.getByRole("button", { name: "C’est ça", exact: true }).click();
  await expect
    .poll(async () => (await call(base + "/memory")).interpretations.length)
    .toBe(1);
  const accepted = (await call(base + "/memory")).interpretations[0];
  await surface.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(phrase).toHaveText("Boire Eau.", { timeout: 20000 });
  assert.equal(
    (await call(base + `/interpretations/${accepted.id}`)).status,
    "confirmed",
  );
  assert.deepEqual(
    (await call(base + `/sequences/${old}`)).block_ids.length,
    2,
  );
  await surface.getByRole("button", { name: "Changer", exact: true }).click();
  const edit = page.getByRole("dialog", {
    name: "Changer la phrase",
    exact: true,
  });
  await edit.getByRole("textbox").fill("J’aime boire de l’eau.");
  const feedbackURL = `**/api/pictoflow/${base}/interpretations/*/feedback`;
  await page.route(feedbackURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic feedback outage" },
    }),
  );
  await edit
    .getByRole("button", { name: "Valider ma correction", exact: true })
    .click();
  await expect(edit.getByRole("alert")).toBeVisible();
  await expect(edit.getByRole("textbox")).toHaveValue("J’aime boire de l’eau.");
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  await page.unroute(feedbackURL);
  await edit
    .getByRole("button", { name: "Valider ma correction", exact: true })
    .click();
  await expect(phrase).toHaveText("J’aime boire de l’eau.");
  assert.equal((await call(base + "/memory")).interpretations.length, 2);
  await page.reload();
  await expect(phrase).toHaveText("J’aime boire de l’eau.");
  assert.deepEqual(await call(base + "/keyboard"), positions);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: ".local/compact-communication/desktop.png",
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "active" });
  const stop = stable.getByRole("button", { name: "Stop", exact: true });
  await stop.focus();
  await expect(stop).toBeFocused();
  assert(
    await stop.evaluate(
      (n) => parseFloat(getComputedStyle(n).outlineWidth) >= 2,
    ),
  );
  await page.screenshot({
    path: ".local/compact-communication/forced-colors.png",
    fullPage: true,
  });
  await page.emulateMedia({ forcedColors: "none" });
  await surface.getByRole("button", { name: "Options", exact: true }).click();
  await page
    .getByRole("button", { name: "Revenir à la communication", exact: true })
    .waitFor();
  await page
    .getByLabel("Proposer une phrase automatiquement après une pause")
    .uncheck();
  await page
    .getByRole("button", { name: "Revenir à la communication", exact: true })
    .click();
  await surface.getByRole("button", { name: "Annuler", exact: true }).click();
  const count = (await automaticRequests()).length;
  await page.waitForTimeout(1700);
  assert.equal((await automaticRequests()).length, count);
  await surface.getByRole("button", { name: "Formuler", exact: true }).click();
  await expect(phrase).toHaveText("Boire.", { timeout: 20000 });
  await surface.getByRole("button", { name: "Pas ça", exact: true }).click();
  await expect(phrase).toHaveText("Boire");
  assert.equal((await call(base + "/memory")).interpretations.length, 2);
  await page.context().setOffline(true);
  await surface.getByRole("button", { name: "Parler", exact: true }).click();
  assert((await page.evaluate(() => window.__spoken)).at(-1).includes("Boire"));
  await page.context().setOffline(false);
  await surface.getByRole("button", { name: "Options", exact: true }).click();
  await page
    .getByLabel("Proposer une phrase automatiquement après une pause")
    .check();
  await page.getByRole("link", { name: /Suggestions :/ }).click();
  const memoryTools = page.getByRole("region", {
    name: "Suggestions de ma mémoire",
    exact: true,
  });
  await memoryTools.getByRole("button", { name: "Mots", exact: true }).click();
  await page
    .getByRole("button", { name: "Revenir à la communication", exact: true })
    .click();
  await surface.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(phrase).toHaveText("Votre message apparaîtra ici.");
  await surface
    .locator(".compact-browse")
    .getByRole("button", { name: "Eau", exact: true })
    .click();
  await expect(phrase).toHaveText("Eau");
  const memoryModeCalls = (await automaticRequests()).length;
  await page.waitForTimeout(1700);
  assert.equal((await automaticRequests()).length, memoryModeCalls);
  await expect(
    surface.getByRole("button", { name: "Formuler", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    ".local/compact-communication/report.json",
    JSON.stringify(
      {
        status: "passed",
        automatic_after_pause: true,
        stale_response_discarded: true,
        typing_during_generation: true,
        no_implicit_speech_or_learning: true,
        stable_positions: true,
        no_document_scroll: true,
        explicit_correction: true,
        literal_offline_speech: true,
        unchanged_keyboard: true,
        memory_only_pauses_ai: true,
        failed_correction_preserves_draft: true,
        keyboard_focus_and_forced_colors: true,
        refusal_returns_to_literal: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS compact select/see/speak/review, serialized automatic snapshots, stale response protection, unchanged stable keys, correction, recovery and offline literal speech",
  );
} catch (error) {
  await fs.mkdir(".local/compact-communication", { recursive: true });
  if (page)
    await page.screenshot({
      path: ".local/compact-communication/failure.png",
      fullPage: true,
    });
  throw error;
} finally {
  await browser.close();
  await api.dispose();
}
