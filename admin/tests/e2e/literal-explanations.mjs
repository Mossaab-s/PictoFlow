import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request } from "@playwright/test";

const origin = "http://127.0.0.1:3131";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const response = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}
const cases = [
  ["disabled", "disabled", "Lors de cet essai, l’aide IA était désactivée."],
  [
    "refusal",
    "model_refusal",
    "L’IA n’a pas proposé de formulation pour cet essai.",
  ],
  [
    "unfaithful",
    "unfaithful_words",
    "Les formulations reçues n’ont pas passé la vérification de vos mots.",
  ],
  [
    "low",
    "low_confidence",
    "Le niveau de confiance annoncé par l’IA était trop faible pour proposer une phrase.",
  ],
  [
    "invalid",
    "invalid_payload",
    "La réponse de l’IA n’a pas pu être utilisée pour proposer une phrase.",
  ],
  [
    "unavailable",
    "unavailable",
    "L’aide IA était indisponible lors de cet essai.",
  ],
];
const browser = await chromium.launch({ headless: true });
try {
  const profile = (
    await call("profiles", "post", { display_name: "Explications fictives" })
  ).id;
  const base = `profiles/${profile}`;
  const blocks = [];
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
      actor_role: "user",
      confirm_representation: true,
    });
    blocks.push(block);
  }
  const positions = await call(base + "/keyboard");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // This scenario exercises the detailed tools available from Options.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("pictoflow:communication-view", "tools");
    } catch {
      /* Optional UI preference. */
    }
  });
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
            voiceURI: "fixture-fr",
            name: "Fixture French",
            lang: "fr-FR",
            localService: true,
            default: true,
          },
        ],
        speak(utterance) {
          window.__spoken.push(utterance.text);
          utterance.onstart?.();
        },
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  let attempts = 0,
    writes = 0;
  const errors = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes++;
    if (r.url().endsWith("/interpret")) attempts++;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/communication/${profile}`);
  const keyboard = page.locator(".communication-keyboard");
  await keyboard.locator(".communication-tile").first().waitFor();
  assert.equal(attempts, 0);
  await fs.mkdir(".local/literal-explanations", { recursive: true });
  for (const [index, [mode, reason, explanation]] of cases.entries()) {
    for (const [position, block] of blocks.entries()) {
      await keyboard
        .getByRole("button", { name: block.label, exact: true })
        .click();
      await page.locator(".message-touch").nth(position).waitFor();
    }
    await page
      .getByRole("button", { name: "Terminer mon message", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Mon message terminé", exact: true })
      .waitFor();
    const sequence = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)).sequence_id,
      `pictoflow:sequence:${profile}`,
    );
    const configured = await api.post(
      "http://127.0.0.1:8001/_synthetic/fixture",
      {
        data: { profile_id: profile, sequence_id: sequence, mode },
      },
    );
    assert(configured.ok());
    assert.equal(attempts, index);
    await page
      .getByRole("button", { name: "Proposer une phrase", exact: true })
      .click();
    const notice = page.locator(".literal-explanation");
    await notice.getByText(explanation, { exact: true }).waitFor();
    const afterProposal = writes;
    const candidate = (await call(base + "/interpretations")).find(
      (c) => c.sequence_id === sequence,
    );
    assert.equal(candidate.source, "pcl");
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.text, "Boire → Eau");
    assert.equal(
      (await call(base + `/interpretations/${candidate.id}/ai-context`))
        .fallback_reason,
      reason,
    );
    assert.equal((await call(base + "/memory")).interpretations.length, 0);
    const beforeAudit = await call(base + "/audit");
    await page.reload();
    await notice.getByText(explanation, { exact: true }).waitFor();
    assert.equal(attempts, index + 1);
    assert.equal(writes, afterProposal);
    assert.deepEqual(await call(base + "/audit"), beforeAudit);
    assert.deepEqual(
      (await call(base + `/sequences/${sequence}`)).block_ids,
      blocks.map((b) => b.id),
    );
    const contextURL = `**/profiles/${profile}/interpretations/${candidate.id}/ai-context`;
    if (mode === "invalid") {
      await page.route(contextURL, (route) =>
        route.fulfill({ status: 503, json: { detail: "private failure" } }),
      );
      await page.reload();
      await notice
        .getByText("L’explication de cet essai n’a pas pu être chargée.", {
          exact: true,
        })
        .waitFor();
      assert(!(await notice.textContent()).includes("private failure"));
      await page.unroute(contextURL);
      await notice
        .getByRole("button", { name: "Recharger l’explication", exact: true })
        .click();
      await notice.getByText(explanation, { exact: true }).waitFor();
      await page
        .locator(".interpretation-card")
        .getByRole("button", { name: "Lire cette phrase", exact: true })
        .click();
      assert.deepEqual(await page.evaluate(() => window.__spoken), [
        "Boire → Eau",
      ]);
      await page.keyboard.press("Escape");
      assert.equal(writes, afterProposal);
      assert.equal(attempts, index + 1);
      assert.equal((await call(base + "/memory")).interpretations.length, 0);
      await page.screenshot({
        path: ".local/literal-explanations/invalid-response-mobile.png",
        fullPage: true,
      });
    }
    if (mode === "disabled") {
      await page.route(contextURL, (route) =>
        route.fulfill({ json: { personal_hypothesis: false, references: [] } }),
      );
      await page.reload();
      await notice
        .getByText("La raison de ce retour aux mots n’a pas été enregistrée.", {
          exact: true,
        })
        .waitFor();
      await page.unroute(contextURL);
      await page.reload();
      await notice.getByText(explanation, { exact: true }).waitFor();
      assert.equal(attempts, index + 1);
      assert.equal(writes, afterProposal);
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(await call(base + "/keyboard"), positions);
    if (index < cases.length - 1) {
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
      assert.equal(await notice.count(), 0);
    } else {
      const card = page.locator(".interpretation-card");
      await card.getByText("Modifier la phrase", { exact: true }).click();
      await card
        .getByLabel("Je corrige la phrase")
        .fill("Je voudrais boire de l’eau.");
      await card
        .getByRole("button", { name: "Valider ma correction", exact: true })
        .click();
      await card.getByText("Mémoire validée", { exact: true }).waitFor();
      assert.equal(await notice.count(), 0);
      assert.equal((await call(base + "/memory")).interpretations.length, 1);
    }
  }
  assert.equal(attempts, 6);
  assert.deepEqual(errors, []);
  console.log(
    "Six recorded literal reasons verified through real API/browser flows, reload, unavailable explanation and read-only retry, legacy metadata, local reading, human correction and unchanged keyboard.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
