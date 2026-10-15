import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request } from "@playwright/test";

const origin = "http://127.0.0.1:3130";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const response = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
async function profile() {
  const p = (
    await call("profiles", "post", { display_name: "Essai PCL fictif" })
  ).id;
  const block = await call(`profiles/${p}/blocks/personal`, "post", {
    request_id: crypto.randomUUID(),
    label: "Boire",
    pictogram_key: "drink",
    actor_role: "user",
  });
  await call(`profiles/${p}/blocks/${block.id}/feedback`, "post", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  return { p, block };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  let interpretations = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname.endsWith("/interpret")
    )
      interpretations++;
  });
  const { p, block } = await profile();
  await page.goto(`${origin}/communication/${p}`);
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
  const keyboard = page.locator(".communication-keyboard");
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await page
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  const learning = page.getByRole("region", {
    name: "Mon PCL et ce message",
    exact: true,
  });
  await learning
    .getByText("Aucun message déjà accepté", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  assert.equal(
    (await call(`profiles/${p}/memory?validated=true`)).interpretations.length,
    0,
  );
  await page.getByLabel("Je corrige la phrase").fill("Je veux boire encore.");
  await page
    .getByRole("button", { name: "Valider ma correction", exact: true })
    .click();
  await learning
    .getByText("Votre correction est conservée", { exact: true })
    .waitFor();
  await learning.getByText("Je veux boire encore.", { exact: true }).waitFor();
  await learning.getByText("Ce que ce choix a changé", { exact: true }).click();
  await learning
    .getByText("Votre correction remplace", { exact: false })
    .waitFor();
  await learning
    .getByText("Voir les décisions humaines", { exact: true })
    .click();
  await learning.getByText("Correction", { exact: true }).waitFor();
  await learning.getByText("Personne utilisatrice", { exact: false }).waitFor();
  const retained = await call(`profiles/${p}/memory?validated=true`);
  assert.equal(retained.interpretations.length, 1);
  const meaning = retained.interpretations[0];
  assert.equal(meaning.status, "corrected");
  assert.equal(meaning.corrected_text, "Je veux boire encore.");
  assert.deepEqual(retained.sequences[0].block_ids, [block.id, block.id]);
  await fs.mkdir(".local/pcl-learning", { recursive: true });
  await learning.screenshot({ path: ".local/pcl-learning/retained.png" });
  await learning
    .getByRole("button", {
      name: "Refaire un essai avec les mêmes touches",
      exact: true,
    })
    .click();
  await learning
    .getByRole("heading", { name: "Déjà dit avec ces touches", exact: true })
    .waitFor();
  const cached = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    `pictoflow:sequence:${p}`,
  );
  assert.notEqual(cached.sequence_id, meaning.sequence_id);
  const repeated = await call(`profiles/${p}/sequences/${cached.sequence_id}`);
  assert.equal(repeated.status, "completed");
  assert.deepEqual(repeated.block_ids, [block.id, block.id]);
  await page.waitForFunction(
    () => document.activeElement?.textContent === "Mon message terminé",
  );
  assert.equal(interpretations, 1);
  await learning
    .getByText("Pourquoi ce souvenir revient", { exact: true })
    .click();
  await learning
    .getByText("Votre correction humaine est prioritaire", { exact: false })
    .waitFor();
  assert.equal(
    await learning
      .getByText("Votre correction est conservée", { exact: true })
      .count(),
    0,
  );

  // Reading memory and choosing the old phrase must not promote the new sequence.
  const beforeReuse = await call(`profiles/${p}/memory?validated=true`);
  await learning
    .getByRole("button", { name: "Retrouver cette phrase", exact: true })
    .click();
  const chosen = page.getByRole("region", {
    name: "Phrase choisie",
    exact: true,
  });
  await chosen.getByText("Je veux boire encore.", { exact: true }).waitFor();
  assert.deepEqual(
    await call(`profiles/${p}/memory?validated=true`),
    beforeReuse,
  );
  assert.equal(interpretations, 1);
  await page.reload();
  await learning
    .getByRole("button", { name: "Retrouver cette phrase", exact: true })
    .waitFor();
  assert.equal(
    (await call(`profiles/${p}/memory?validated=true`)).interpretations.length,
    1,
  );

  // An unavailable memory must not keep a stale successful claim on screen.
  const memoryRoute = `**/api/pictoflow/profiles/${p}/memory?validated=true`;
  await page.route(memoryRoute, (route) =>
    route.fulfill({ status: 503, json: { detail: "Synthetic outage" } }),
  );
  await learning
    .getByRole("button", { name: "Vérifier la mémoire", exact: true })
    .click();
  await learning.getByRole("alert").waitFor();
  assert.equal(
    await learning.getByText("Je veux boire encore.", { exact: true }).count(),
    0,
  );
  await page.unroute(memoryRoute);
  await learning
    .getByRole("button", { name: "Vérifier la mémoire", exact: true })
    .click();
  await learning
    .getByRole("button", { name: "Retrouver cette phrase", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 320, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await learning.screenshot({
    path: ".local/pcl-learning/recalled-mobile.png",
  });
  await call(`profiles/${p}/interpretations/${meaning.id}/feedback`, "post", {
    action: "reject",
    actor_role: "user",
  });
  await learning
    .getByRole("button", { name: "Vérifier la mémoire", exact: true })
    .click();
  await learning
    .getByText("Aucun message déjà accepté", { exact: false })
    .waitFor();
  assert.equal(
    await learning
      .getByRole("button", { name: "Retrouver cette phrase", exact: true })
      .count(),
    0,
  );

  // Failed replay keeps the new partial sequence, never the old accepted decision.
  const second = await profile();
  const base = `profiles/${second.p}`;
  let sequence = await call(base + "/sequences", "post", {
    session_id: crypto.randomUUID(),
  });
  for (const action of ["append", "append", "complete"])
    sequence = await call(
      `${base}/sequences/${sequence.id}/selection`,
      "post",
      { action, ...(action === "append" ? { block_id: second.block.id } : {}) },
    );
  const decision = await call(
    `${base}/sequences/${sequence.id}/interpret`,
    "post",
    {},
  );
  await call(
    `${base}/interpretations/${decision.candidates[0].id}/feedback`,
    "post",
    { action: "confirm", actor_role: "user" },
  );
  await page.evaluate(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: `pictoflow:sequence:${second.p}`,
      value: {
        sequence_id: sequence.id,
        decision: {
          state: decision.state,
          candidate_ids: decision.candidates.map((item) => item.id),
        },
      },
    },
  );
  await page.goto(`${origin}/communication/${second.p}`);
  const secondLearning = page.getByRole("region", {
    name: "Mon PCL et ce message",
    exact: true,
  });
  await secondLearning
    .getByText("Votre phrase est conservée", { exact: true })
    .waitFor();
  let appended = 0;
  await page.route(
    `**/api/pictoflow/${base}/sequences/*/selection`,
    (route) => {
      if (
        route.request().postDataJSON()?.action === "append" &&
        ++appended === 2
      )
        return route.fulfill({
          status: 503,
          json: { detail: "Synthetic append failure" },
        });
      return route.continue();
    },
  );
  await secondLearning
    .getByRole("button", {
      name: "Refaire un essai avec les mêmes touches",
      exact: true,
    })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Le service est indisponible." })
    .waitFor();
  const partial = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    `pictoflow:sequence:${second.p}`,
  );
  assert.notEqual(partial.sequence_id, sequence.id);
  assert.equal(partial.decision, undefined);
  await page.waitForFunction(
    () => document.activeElement?.textContent === "Mon message",
  );
  assert.deepEqual(
    (await call(`${base}/sequences/${partial.sequence_id}`)).block_ids,
    [second.block.id],
  );
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Vérifier ce que je veux dire",
        exact: true,
      })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "POC verified: human correction retained, exact replay, memory recall without AI or auto-validation, reload, revocation, outage and interrupted replay.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
