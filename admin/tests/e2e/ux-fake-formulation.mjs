import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request } from "@playwright/test";

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
try {
  const p = (
    await call("profiles", "post", { display_name: "Formulation fictive" })
  ).id;
  const base = `profiles/${p}`;
  for (const [label, key] of [
    ["Boire", "drink"],
    ["Eau", "water"],
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
  }
  const positions = await call(base + "/keyboard");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  let ai = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/interpret")) ai++;
  });
  await page.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
      configurable: true,
    });
    Object.defineProperty(window, "speechSynthesis", {
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
        cancel() {},
        speak(u) {
          window.__spoken.push(u.text);
          u.onstart?.();
        },
        addEventListener() {},
        removeEventListener() {},
      },
      configurable: true,
    });
  });
  await page.goto(`${origin}/communication/${p}`);
  const keyboard = page.locator(".communication-keyboard");
  for (let trial = 0; trial < 2; trial++) {
    for (const [index, label] of ["Boire", "Eau"].entries()) {
      await keyboard.getByRole("button", { name: label, exact: true }).click();
      await page.locator(".message-touch").nth(index).waitFor();
    }
    await page
      .getByRole("button", { name: "Terminer mon message", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Mon message terminé", exact: true })
      .waitFor();
    const seq = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)).sequence_id,
      `pictoflow:sequence:${p}`,
    );
    const configured = await api.post(
      "http://127.0.0.1:8001/_synthetic/fixture",
      { data: { profile_id: p, sequence_id: seq } },
    );
    assert(configured.ok());
    assert.equal((await configured.json()).provider, "fake");
    assert.equal(ai, trial);
    await page
      .getByRole("button", { name: "Proposer une phrase", exact: true })
      .click();
    const card = page.locator(".interpretation-card");
    await card.getByText("Je veux boire de l’eau.", { exact: true }).waitFor();
    const candidate = (await call(base + "/interpretations")).find(
      (i) => i.sequence_id === seq,
    );
    assert.equal(candidate.source, "fake");
    assert.equal(candidate.status, "proposed");
    assert.equal((await call(base + "/memory")).interpretations.length, 0);
    if (!trial) {
      await card
        .getByRole("button", { name: "Lire cette phrase", exact: true })
        .click();
      assert.deepEqual(await page.evaluate(() => window.__spoken), [
        "Je veux boire de l’eau.",
      ]);
      await page.keyboard.press("Escape");
      assert.equal((await call(base + "/memory")).interpretations.length, 0);
      await card
        .getByRole("button", { name: "Ce n'est pas mon sens", exact: true })
        .click();
      await card.getByText("Proposition écartée", { exact: true }).waitFor();
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
    } else {
      await card
        .getByRole("button", { name: "C'est ce que je veux dire", exact: true })
        .click();
      await card.getByText("Mémoire validée", { exact: true }).waitFor();
    }
  }
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  assert.deepEqual(await call(base + "/keyboard"), positions);
  assert.equal(ai, 2);
  assert.deepEqual(errors, []);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await fs.mkdir(".local/ux-communication", { recursive: true });
  await page.screenshot({
    path: ".local/ux-communication/fake-formulation-mobile.png",
    fullPage: true,
  });
  console.log(
    "Real fixture-driven FakeProvider verified through the browser: explicit request, local reading without acceptance, refusal, new message, human acceptance and unchanged keyboard.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
