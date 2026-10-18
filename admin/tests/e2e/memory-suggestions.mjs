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
async function prepare(acceptedText = null) {
  const p = (
    await call("profiles", "post", { display_name: "Suggestions fictives" })
  ).id;
  const base = `profiles/${p}`;
  const blocks = {};
  for (const [label, drawing] of [
    ["Boire", "drink"],
    ["Eau", "water"],
    ["Livre", "book"],
  ]) {
    const block = await call(base + "/blocks/personal", "post", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key: drawing,
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, "post", {
      action: "confirm",
      actor_role: "user",
      confirm_representation: true,
    });
    blocks[label] = block;
  }
  if (acceptedText) {
    const sequence = await call(base + "/sequences", "post", {
      session_id: crypto.randomUUID(),
    });
    await call(base + `/sequences/${sequence.id}/selection`, "post", {
      action: "append",
      block_id: blocks.Livre.id,
    });
    await call(base + `/sequences/${sequence.id}/selection`, "post", {
      action: "complete",
    });
    // DisabledProvider seeds one literal proposal; only explicit human feedback accepts it.
    const meaning = (
      await call(base + `/sequences/${sequence.id}/interpret`, "post", {})
    ).candidates[0];
    await call(base + `/interpretations/${meaning.id}/feedback`, "post", {
      action: "correct",
      actor_role: "user",
      corrected_value: acceptedText,
    });
  }
  return { p, base, blocks };
}

const browser = await chromium.launch({ headless: true });
let page;
try {
  const own = await prepare("Je veux boire de l’eau.");
  const empty = await prepare();
  const foreign = await prepare("Papillon confidentiel.");
  const before = await call(own.base + "/memory");
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  page = await context.newPage();
  page.on("response", (r) => {
    if (r.url().includes("/memory-suggestions?"))
      console.log("Synthetic suggestion response:", r.status());
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  let unexpectedAI = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/interpret", (route) => {
    unexpectedAI++;
    return route.abort();
  });
  const panel = page.getByRole("region", {
    name: "Suggestions de ma mémoire",
    exact: true,
  });
  async function compose(profile = own) {
    await page
      .locator(".communication-keyboard")
      .getByRole("button", { name: "Boire", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Terminer mon message", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Mon message terminé", exact: true })
      .waitFor();
    assert((await call(profile.base + "/sequences")).length > 0);
    if (
      !(await page
        .locator(".communication-suggestion-options")
        .evaluate((element) => element.open))
    )
      await page.locator(".communication-suggestion-options > summary").click();
  }
  await page.goto(`${origin}/communication/${own.p}`);
  await compose();
  await panel.getByRole("button", { name: "Mots", exact: true }).click();
  await panel.locator(".memory-word-cards article").first().waitFor();
  assert.equal(await panel.locator(".memory-word-cards article").count(), 3);
  await panel
    .getByRole("button", { name: "Voir plus de suggestions", exact: true })
    .click();

  await panel
    .getByRole("button", { name: "Ajouter « eau »", exact: true })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Ajouter « Livre »", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Proposer une phrase", exact: true })
      .count(),
    0,
  );
  assert.equal(await panel.getByText("Papillon", { exact: true }).count(), 0);
  const water = panel.locator("article").filter({
    has: page.getByRole("button", { name: "Ajouter « eau »", exact: true }),
  });
  assert.equal(await water.locator("svg").count(), 1);
  await panel
    .getByRole("button", { name: "Écarter « eau »", exact: true })
    .click();
  await page.waitForFunction(
    () => document.activeElement?.textContent === "Suggestions de ma mémoire",
  );
  assert.deepEqual(await call(own.base + "/memory"), before);
  await panel
    .getByRole("button", {
      name: "Réafficher les suggestions écartées",
      exact: true,
    })
    .click();
  for (const word of ["Je", "veux", "boire", "de", "l’", "eau"])
    await panel
      .getByRole("button", { name: `Ajouter « ${word} »`, exact: true })
      .click();
  const draft = panel.getByRole("region", {
    name: "Ma proposition avec mes mots",
    exact: true,
  });
  await draft.getByText("Je veux boire de l’eau", { exact: true }).waitFor();
  await fs.mkdir(".local/memory-suggestions", { recursive: true });
  await panel.screenshot({ path: ".local/memory-suggestions/words.png" });
  await panel
    .getByRole("button", { name: "Proposer cette phrase de mots", exact: true })
    .click();
  await page
    .locator(".interpretation-card .proposed-phrase")
    .filter({ hasText: "Je veux boire de l’eau" })
    .waitFor();
  assert.deepEqual(await call(own.base + "/memory"), before);
  await page
    .getByRole("button", { name: "Ce n'est pas mon sens", exact: true })
    .click();
  await page.getByText("Proposition écartée", { exact: true }).waitFor();
  assert.deepEqual(await call(own.base + "/memory"), before);
  await panel.getByRole("button", { name: "Phrases", exact: true }).click();
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .click();
  await page
    .locator(".interpretation-card .proposed-phrase")
    .filter({ hasText: "Je veux boire de l’eau." })
    .waitFor();
  assert.deepEqual(await call(own.base + "/memory"), before);
  await page
    .getByRole("button", { name: "C'est ce que je veux dire", exact: true })
    .click();
  await page.getByText("Votre phrase est conservée", { exact: true }).waitFor();
  assert.equal((await call(own.base + "/memory")).interpretations.length, 2);
  await page.reload();
  await panel
    .locator('button[aria-pressed="true"]')
    .filter({ hasText: /^Phrases$/ })
    .waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Phrases", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .getByRole("button", { name: "Nouveau message", exact: true })
    .click();
  await compose();
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .waitFor();
  const source = (await call(own.base + "/memory-suggestions?mode=phrases"))
    .phrases[0];
  await call(
    own.base +
      `/interpretations/${source.reference.interpretation_id}/feedback`,
    "post",
    { action: "reject", actor_role: "user" },
  );
  const interpretationsBefore = await call(own.base + "/interpretations");
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .click();
  await page
    .getByText(
      "Cette suggestion a changé ou n’est plus disponible. Actualisez les suggestions, puis vérifiez votre choix.",
      {
        exact: true,
      },
    )
    .waitFor();
  assert.deepEqual(
    await call(own.base + "/interpretations"),
    interpretationsBefore,
  );
  await panel
    .getByRole("button", { name: "Actualiser les suggestions", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .waitFor();
  let lost = false;
  await page.route("**/memory-proposals", async (route) => {
    if (!lost) {
      lost = true;
      const response = await route.fetch();
      assert(response.ok());
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .click();
  await page
    .getByText(
      "La connexion a été interrompue. Réessayez la même proposition.",
      { exact: true },
    )
    .waitFor();
  const afterLost = await call(own.base + "/interpretations");
  await panel
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .click();
  await page
    .locator(".interpretation-card .proposed-phrase")
    .filter({ hasText: "Je veux boire de l’eau." })
    .waitFor();
  assert.deepEqual(await call(own.base + "/interpretations"), afterLost);
  await page.unroute("**/memory-proposals");
  await panel.getByRole("button", { name: "Mots", exact: true }).click();

  await page.setViewportSize({ width: 320, height: 900 });
  const filtered = page.waitForResponse((r) =>
    r.url().includes("/memory-suggestions?mode=words&q=eau&"),
  );
  await panel.getByLabel("Rechercher dans mes suggestions").fill("eau");
  await filtered;
  await panel
    .getByRole("button", { name: "Ajouter « eau »", exact: true })
    .waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await panel.screenshot({
    path: ".local/memory-suggestions/words-mobile.png",
  });
  const suggestionURL = (url) => url.pathname.endsWith("/memory-suggestions");
  await page.route(suggestionURL, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  const unavailable = page
    .waitForResponse(
      (r) => r.url().includes("/memory-suggestions?") && r.status() === 503,
      { timeout: 5000 },
    )
    .then((response) => response.status())
    .catch(() => null);
  const refreshButton = panel.getByRole("button", {
    name: "Actualiser les suggestions",
    exact: true,
  });
  await page.evaluate(() => {
    window.__uxPointer = [];
    for (const type of [
      "pointerdown",
      "mousedown",
      "focusin",
      "pointerup",
      "mouseup",
      "click",
      "scroll",
    ])
      document.addEventListener(
        type,
        (e) => {
          window.__uxPointer.push({
            type,
            target:
              e.target.closest?.("button")?.textContent?.trim() ??
              e.target.tagName,
            scroll: window.scrollY,
            active: document.activeElement?.tagName,
            button: [...document.querySelectorAll("button")]
              .find(
                (b) => b.textContent.trim() === "Actualiser les suggestions",
              )
              ?.getBoundingClientRect()
              .toJSON(),
          });
        },
        { capture: true },
      );
  });
  await panel
    .getByRole("button", { name: "Actualiser les suggestions", exact: true })
    .click();
  console.log(
    "Synthetic refresh pointer events:",
    await page.evaluate(() => window.__uxPointer),
  );
  assert(
    await page.evaluate(() =>
      window.__uxPointer.some(
        (e) => e.type === "click" && e.target === "Actualiser les suggestions",
      ),
    ),
    "The refresh pointer activation must reach the control",
  );
  assert.equal(
    await unavailable,
    503,
    "The unavailable suggestion response must be injected",
  );
  await panel.getByRole("alert").waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: "Ajouter « eau »", exact: true })
      .count(),
    0,
  );
  await page.unroute(suggestionURL);
  await panel
    .getByRole("button", { name: "Actualiser les suggestions", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Ajouter « eau »", exact: true })
    .waitFor();
  await page.goto(`${origin}/communication/${empty.p}`);
  await compose(empty);
  assert.equal(
    await panel
      .getByRole("button", { name: "Désactivées", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await panel.getByRole("button", { name: "Mots", exact: true }).click();

  await panel
    .getByText("Aucune phrase acceptée pour le moment.", { exact: false })
    .waitFor();
  await page.goto(`${origin}/communication/${foreign.p}`);
  await compose(foreign);
  await panel.getByRole("button", { name: "Phrases", exact: true }).click();
  await panel.getByText("Papillon confidentiel.", { exact: true }).waitFor();
  assert.equal(
    await panel.getByText("Je veux boire de l’eau.", { exact: true }).count(),
    0,
  );
  assert.equal(unexpectedAI, 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Memory-only suggestions verified: all accepted words, existing drawing, phrase selection, explicit confirmation/rejection, source revocation, idempotent retry, outage, profile isolation and mobile.",
  );
} catch (error) {
  if (page) {
    await fs.mkdir(".local/memory-suggestions", { recursive: true });
    await page.screenshot({
      path: ".local/memory-suggestions/failure.png",
      fullPage: true,
    });
    console.log(
      "Synthetic suggestion UI at failure:",
      await page.locator(".memory-suggestions").innerText(),
    );
  }
  throw error;
} finally {
  await browser.close();
  await api.dispose();
}
