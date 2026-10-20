import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";

const origin = "http://127.0.0.1:3131";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const response = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}
const browser = await chromium.launch({ headless: true });
let page;
try {
  const profile = await call("profiles", "post", {
    display_name: "Comparer des sens fictifs",
  });
  const base = `profiles/${profile.id}`;
  for (const [label, key] of [
    ["Boire", "drink"],
    ["Eau", "water"],
  ]) {
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
  }
  const positions = await call(base + "/keyboard");
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [],
    interpretationRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/interpret"))
      interpretationRequests.push(r.postDataJSON());
  });
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__canceled = 0;
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
        cancel() {
          window.__canceled++;
        },
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  await page.goto(`${origin}/communication/${profile.id}`);
  async function compose() {
    for (const [index, label] of ["Boire", "Eau"].entries()) {
      await page
        .locator(".communication-keyboard")
        .getByRole("button", { name: label, exact: true })
        .click();
      await page.locator(".message-touch").nth(index).waitFor();
    }
    await page
      .getByRole("button", { name: "Terminer mon message", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Mon message terminé", exact: true })
      .waitFor();
    return page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)).sequence_id,
      `pictoflow:sequence:${profile.id}`,
    );
  }
  const sequence = await compose();
  const configured = await api.post(
    "http://127.0.0.1:8001/_synthetic/fixture",
    {
      data: {
        profile_id: profile.id,
        sequence_id: sequence,
        mode: "alternatives",
      },
    },
  );
  assert(configured.ok());
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  const choices = page.getByRole("group", {
    name: "Plusieurs sens sont possibles",
    exact: true,
  });
  const radios = choices.getByRole("radio");
  await expect(radios).toHaveCount(3);
  const card = page.locator(".interpretation-card:visible");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".proposed-phrase")).toHaveText(
    "Je veux boire de l’eau.",
  );
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await radios.nth(1).check();
  await expect(card.locator(".proposed-phrase")).toHaveText(
    "Je bois de l’eau.",
  );
  await card.getByText("Modifier la phrase", { exact: true }).click();
  const correction = "J’aime boire de l’eau.";
  await card.getByLabel("Je corrige la phrase").fill(correction);
  await radios.nth(1).focus();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(2)).toBeChecked();
  await expect(card.locator(".proposed-phrase")).toHaveText("Boire de l’eau ?");
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await card
    .getByRole("button", { name: "Lire cette phrase", exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.__spoken), [
    "Boire de l’eau ?",
  ]);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  const cancellations = await page.evaluate(() => window.__canceled);
  await radios.nth(0).check();
  assert((await page.evaluate(() => window.__canceled)) > cancellations);
  await card
    .getByRole("button", { name: "Ce n'est pas mon sens", exact: true })
    .click();
  await expect(
    card.getByText("Proposition écartée", { exact: true }),
  ).toBeVisible();
  await radios.nth(1).check();
  await expect(card.getByLabel("Je corrige la phrase")).toHaveValue(correction);
  await fs.mkdir(".local/phrase-hypotheses", { recursive: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await choices.screenshot({
    path: ".local/phrase-hypotheses/choices-mobile.png",
  });
  await card
    .getByRole("button", { name: "Valider ma correction", exact: true })
    .click();
  await expect(
    card.getByText("Mémoire validée", { exact: true }),
  ).toBeVisible();
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(0)).toBeDisabled();
  const interpretations = (await call(base + "/interpretations")).filter(
    (item) => item.sequence_id === sequence,
  );
  assert.deepEqual(interpretations.map((item) => item.status).sort(), [
    "corrected",
    "proposed",
    "rejected",
  ]);
  const accepted = (await call(base + "/memory")).interpretations;
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].corrected_text, correction);
  await page.reload();
  await expect(card.locator(".proposed-phrase")).toHaveText(correction);
  await expect(radios.nth(1)).toBeChecked();
  assert.equal(interpretationRequests.length, 1);
  await page
    .getByRole("button", { name: "Nouveau message", exact: true })
    .click();
  await page
    .getByText("Votre message apparaîtra ici.", { exact: true })
    .waitFor();
  await compose();
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await expect(card.locator(".proposed-phrase")).toHaveText(correction);
  await expect(choices).toHaveCount(0);
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  assert.equal(
    (await (await api.get("http://127.0.0.1:8001/_synthetic/calls")).json())
      .calls,
    1,
  );
  assert.deepEqual(await call(base + "/keyboard"), positions);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    ".local/phrase-hypotheses/report.json",
    JSON.stringify(
      {
        status: "passed",
        compared: 3,
        keyboard_and_mouse: true,
        no_implicit_speech_or_acceptance: true,
        correction_draft_preserved: true,
        refusal_is_individual: true,
        sole_accepted_phrase_restored: true,
        single_memory_proposal_stays_direct: true,
        no_overflow: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS compare three meanings, keyboard/mouse inspection, explicit speech, individual refusal, correction, accepted recovery and single memory choice",
  );
} catch (error) {
  await fs.mkdir(".local/phrase-hypotheses", { recursive: true });
  if (page)
    await page.screenshot({
      path: ".local/phrase-hypotheses/failure.png",
      fullPage: true,
    });
  throw error;
} finally {
  await browser.close();
  await api.dispose();
}
