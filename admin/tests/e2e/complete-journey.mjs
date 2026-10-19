import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request, expect } from "@playwright/test";

// Real cookies, grants and PostgreSQL. Only accounts and the foreign control
// profile are seeded through the API; the target profile's workflow uses the UI.
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
const p = (
  await call("profiles", "POST", { display_name: "Parcours POC fictif" })
).id;
const foreign = (
  await call("profiles", "POST", {
    display_name: "Autre sens personnel fictif",
  })
).id;
const base = `profiles/${p}`;
const foreignBase = `profiles/${foreign}`;
const foreignTouch = await call(foreignBase + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Eau",
  meaning: "L’eau de ma piscine",
  pictogram_key: "water",
  actor_role: "user",
});
await call(foreignBase + `/blocks/${foreignTouch.id}/feedback`, "POST", {
  action: "confirm",
  confirm_representation: true,
  actor_role: "user",
});
const foreignSequence = await call(foreignBase + "/sequences", "POST", {
  session_id: crypto.randomUUID(),
});
await call(foreignBase + `/sequences/${foreignSequence.id}/selection`, "POST", {
  action: "append",
  block_id: foreignTouch.id,
});
await call(foreignBase + `/sequences/${foreignSequence.id}/selection`, "POST", {
  action: "complete",
});
const foreignMeaning = (
  await call(
    foreignBase + `/sequences/${foreignSequence.id}/interpret`,
    "POST",
    {},
  )
).candidates[0];
await call(
  foreignBase + `/interpretations/${foreignMeaning.id}/feedback`,
  "POST",
  {
    action: "correct",
    corrected_value: "Je voudrais aller à la piscine.",
    actor_role: "user",
  },
);
const foreignBefore = {};
for (const resource of ["audit", "memory", "blocks", "keyboard"])
  foreignBefore[resource] = await call(foreignBase + "/" + resource);
async function account(suffix, capabilities) {
  const user = await call("auth/users", "POST", {
    username: `journey-ci-${suffix}`,
    display_name: `Compte fictif ${suffix}`,
    password,
  });
  await call(`auth/users/${user.id}/profiles/${p}/capabilities`, "PUT", {
    capabilities,
    expected_capabilities: null,
  });
  return user;
}
const supporter = await account("supporter", [
  "prepare_keyboard",
  "review_meanings",
  "view_history",
]);
const communicator = await account("communicator", ["communicate"]);
const observer = await account("observer", ["view_history"]);
assert.equal((await call("providers")).provider_id, "disabled");
const report = {
  schema_version: 1,
  status: "running",
  data: "synthetic",
  provider: "disabled",
  scenario:
    "Prepare drawings and words, compose six touches, review, reuse and refuse",
  checkpoints: [],
  limits: [
    "No external model quality claim",
    "No participant usability or accessibility certification",
    "No deployment",
  ],
};
const mark = (name) => report.checkpoints.push({ name, status: "passed" });
await fs.mkdir(".local/complete-journey", { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let active;
async function connect(user, width) {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  active = page;
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  return { context, page };
}
async function noOverflow(page) {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
}
const corrected = "Maman, je voudrais boire de l’eau à la maison.";
const chosen = ["Maman", "Boire", "Eau", "Maison", "Eau", "Maison"];
try {
  const support = await connect(supporter, 1024);
  const speaker = await connect(communicator, 1024);
  const review = support.page;
  const speak = speaker.page;
  await expect(speak).toHaveURL(`${origin}/communication/${p}`);
  await review
    .getByRole("link", { name: "Parcours POC fictif", exact: false })
    .click();
  await review
    .getByRole("navigation", { name: "Activités de la personne", exact: true })
    .getByRole("link", { name: "Clavier", exact: true })
    .click();
  await expect(review).toHaveURL(
    `${origin}/accompagnement/personnes/${p}/clavier`,
  );
  const creator = review.locator(".touch-creator");
  const preview = review.getByRole("region", {
    name: "Aperçu du clavier de communication",
    exact: true,
  });
  const blocks = {};
  for (const [word, meaning] of [
    ["Eau", "Mon verre pour boire"],
    ["Maman", "Ma maman"],
    ["Boire", "Boire une boisson"],
    ["Maison", "Chez moi"],
  ]) {
    active = review;
    await creator
      .getByLabel("Rechercher un dessin", { exact: true })
      .fill(word);
    await creator.getByRole("radio", { name: word, exact: true }).check();
    await creator
      .getByRole("button", { name: "Continuer : le mot", exact: true })
      .click();
    await creator
      .getByLabel("Texte affiché sur la touche", { exact: true })
      .fill(word);
    await creator
      .getByText("Préciser le sens (facultatif)", { exact: true })
      .click();
    await creator
      .getByLabel("Ce que cette touche signifie pour moi, facultatif", {
        exact: false,
      })
      .fill(meaning);
    await creator
      .getByRole("button", { name: "Voir la touche à vérifier", exact: true })
      .click();
    await creator
      .getByRole("button", { name: "Créer la touche à vérifier", exact: true })
      .click();
    const proposed = review.locator(".block-list > section.panel").filter({
      has: review.getByRole("heading", { name: word, exact: true }),
    });
    await proposed
      .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
      .waitFor();
    blocks[word] = (await call(base + "/blocks")).find(
      (block) => block.label === word,
    );
    assert.equal(blocks[word].status, "proposed");
    assert.equal(await preview.getByText(word, { exact: true }).count(), 0);
    if (word === "Eau") {
      await speak.reload();
      await speak
        .getByRole("heading", { name: "Je communique", exact: true })
        .waitFor();
      assert.equal(
        await speak
          .locator(".communication-keyboard")
          .getByRole("button", { name: word, exact: true })
          .count(),
        0,
      );
      const session = await (
        await speaker.context.request.get(
          origin + "/api/pictoflow/auth/session",
        )
      ).json();
      const denied = await speaker.context.request.post(
        `${origin}/api/pictoflow/${base}/blocks/${blocks[word].id}/feedback`,
        {
          headers: { Origin: origin, "X-CSRF-Token": session.csrf_token },
          data: {
            action: "confirm",
            actor_role: "professional",
            confirm_representation: true,
          },
        },
      );
      assert.equal(denied.status(), 403);
      assert.equal((await call(base + "/blocks"))[0].status, "proposed");
      mark(
        "A proposed drawing/word stays absent from communication; forged role cannot validate it",
      );
    }
    await proposed
      .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
      .click();
    await expect(preview.getByText(word, { exact: true })).toBeVisible();
  }
  await review
    .getByLabel("Modifier la touche « Maman »", { exact: true })
    .click();
  const mother = review.locator(".block-list > section.panel").filter({
    has: review.getByRole("heading", { name: "Maman", exact: true }),
  });
  await mother.getByRole("combobox", { name: /^Zone/ }).selectOption("stable");
  await mother.getByLabel("Place", { exact: true }).fill("1");
  await mother
    .getByRole("button", {
      name: "Enregistrer la place de « Maman »",
      exact: true,
    })
    .click();
  await review
    .getByText("La position de la touche a été enregistrée.", { exact: true })
    .waitFor();
  const placements = await call(base + "/keyboard");
  assert(
    placements.some(
      (position) =>
        position.block_id === blocks.Maman.id &&
        position.zone === "stable" &&
        position.position === 0 &&
        position.locked,
    ),
  );
  assert.deepEqual(await call(base + "/sequences"), []);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await noOverflow(review);
  await preview.screenshot({
    path: ".local/complete-journey/prepared-keyboard.png",
  });
  mark(
    "Supporter prepares four simple pictograms in the UI, validates them and saves a stable anchor without composing",
  );

  active = speak;
  await speak.reload();
  const keyboard = speak.locator(".communication-keyboard");
  const interpretCalls = [];
  speak.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/interpret"))
      interpretCalls.push(req.url());
  });
  for (const [index, word] of chosen.entries()) {
    const key = keyboard.getByRole("button", { name: word, exact: true });
    if (index % 2 === 0) {
      await key.focus();
      await speak.keyboard.press("Enter");
    } else await key.click();
    await expect(speak.locator(".message-touch .touch-word")).toHaveText(
      chosen.slice(0, index + 1),
    );
  }
  await speak
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  await speak
    .getByRole("heading", { name: "Mon message terminé", exact: true })
    .waitFor();
  const first = (await call(base + "/sequences"))[0];
  assert.equal(first.status, "completed");
  assert.deepEqual(
    first.block_ids,
    chosen.map((word) => blocks[word].id),
  );
  assert.equal(interpretCalls.length, 0);
  await speak
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await speak
    .getByRole("heading", { name: "Vérifier ce que je veux dire", exact: true })
    .waitFor();
  const candidate = (await call(base + "/interpretations"))[0];
  assert.equal(candidate.sequence_id, first.id);
  assert.equal(candidate.source, "pcl");
  assert.equal(candidate.status, "proposed");
  assert.equal(
    await speak
      .getByRole("button", { name: "C'est ce que je veux dire", exact: true })
      .count(),
    0,
  );
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await speak.reload();
  await expect(speak.locator(".message-touch .touch-word")).toHaveText(chosen);
  assert.equal(interpretCalls.length, 1);
  mark(
    "Communicator uses keyboard and mouse for six ordered touches with repetitions; reload preserves the proposal without accepting it",
  );

  active = review;
  await review.goto(`${origin}/accompagnement/personnes/${p}/a-verifier`);
  await expect(review.locator(".review-message")).toHaveCount(1);
  await expect(review.locator(".memory-touches .touch-word")).toHaveText(
    chosen,
  );
  await review.locator(".role-selector select").selectOption("professional");
  const proposal = review.getByRole("article", {
    name: candidate.text,
    exact: true,
  });
  await proposal.getByText("Corriger cette phrase", { exact: true }).click();
  await proposal.getByLabel("Phrase corrigée", { exact: true }).fill(corrected);
  await proposal
    .getByRole("button", { name: "Enregistrer la correction", exact: true })
    .click();
  await review
    .getByText("Votre correction est enregistrée dans la mémoire du profil.", {
      exact: true,
    })
    .waitFor();
  const retained = await call(base + "/memory");
  assert.equal(retained.interpretations.length, 1);
  assert.equal(retained.interpretations[0].id, candidate.id);
  assert.equal(retained.interpretations[0].corrected_text, corrected);
  assert.deepEqual(retained.sequences[0].block_ids, first.block_ids);
  const readOnly = await connect(observer, 390);
  active = readOnly.page;
  await readOnly.page.goto(
    `${origin}/accompagnement/personnes/${p}/historique`,
  );
  const change = readOnly.page.getByRole("article", {
    name: "Phrase corrigée",
    exact: true,
  });
  await expect(change).toBeVisible();
  await expect(change).toContainText(corrected);
  await expect(change).toContainText("Professionnel");
  await expect(change.locator(".memory-touches .touch-word")).toHaveText(
    chosen,
  );
  assert.equal(
    await readOnly.page
      .getByRole("button", { name: "Confirmer cette phrase", exact: true })
      .count(),
    0,
  );
  await noOverflow(readOnly.page);
  await change.scrollIntoViewIfNeeded();
  await readOnly.page.screenshot({
    path: ".local/complete-journey/personal-evolution-mobile.png",
  });
  mark(
    "A separate authorized reviewer accepts a correction; a history-only account reads the actual decision and original six touches",
  );

  active = speak;
  await speak.reload();
  await speak
    .getByRole("button", { name: "Nouveau message", exact: true })
    .click();
  const reset = speak.getByRole("dialog");
  if (await reset.isVisible())
    await reset
      .getByRole("button", {
        name: "Oui, commencer un autre message",
        exact: true,
      })
      .click();
  await expect(speak.locator(".message-touch")).toHaveCount(0);
  await keyboard.getByRole("button", { name: "Eau", exact: true }).click();
  await speak
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  await speak
    .getByRole("heading", { name: "Mon message terminé", exact: true })
    .waitFor();
  const disclosure = speak.locator(".communication-suggestion-options");
  if (!(await disclosure.evaluate((element) => element.open)))
    await disclosure.locator(":scope > summary").click();
  const suggestions = speak.getByRole("region", {
    name: "Suggestions de ma mémoire",
    exact: true,
  });
  await suggestions
    .getByRole("button", { name: "Phrases", exact: true })
    .click();
  await expect(suggestions.locator(".phrase-cards article")).toHaveCount(1);
  await expect(suggestions.locator(".phrase-cards article")).toContainText(
    corrected,
  );
  assert.equal(await suggestions.getByText(/piscine/).count(), 0);
  assert.equal(
    (await call(base + "/memory-suggestions?mode=phrases")).phrases[0].reference
      .interpretation_id,
    candidate.id,
  );
  await suggestions
    .getByRole("button", { name: "Proposer cette phrase", exact: true })
    .click();
  await expect(
    speak.locator(".interpretation-card .proposed-phrase"),
  ).toHaveText(corrected);
  const reuse = (await call(base + "/interpretations")).find(
    (item) => item.id !== candidate.id,
  );
  assert.equal(reuse.source, "pcl-memory");
  assert.equal(reuse.status, "proposed");
  assert.notEqual(reuse.sequence_id, first.id);
  assert.deepEqual(await call(base + "/memory"), retained);
  assert.equal(interpretCalls.length, 1);
  await noOverflow(speak);
  await suggestions.screenshot({
    path: ".local/complete-journey/personal-memory-reuse.png",
  });
  mark(
    "The next message proposes the exact accepted personal phrase with source provenance and no second interpretation call or automatic acceptance",
  );

  active = review;
  await review.goto(`${origin}/accompagnement/personnes/${p}/a-verifier`);
  const reused = review.getByRole("article", { name: corrected, exact: true });
  await reused
    .getByRole("button", { name: "Refuser cette phrase", exact: true })
    .click();
  await review
    .getByText("Phrase refusée. Elle n’entre pas dans les phrases acceptées.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await call(base + `/interpretations/${reuse.id}`)).status,
    "rejected",
  );
  assert.deepEqual(await call(base + "/memory"), retained);
  assert.deepEqual(await call(base + "/keyboard"), placements);
  const facts = (
    await call(
      base +
        `/feedback?target_type=interpretation&target_id=${candidate.id}&limit=20`,
    )
  ).items;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].actor_role, "professional");
  mark(
    "Refusing a new memory-derived proposal preserves its original accepted reference and all saved keyboard positions",
  );

  const deniedReads = [];
  speak.on("request", (req) => {
    if (req.url().includes(`/api/pictoflow/${foreignBase}/`))
      deniedReads.push(req.url());
  });
  active = speak;
  await speak.goto(`${origin}/communication/${foreign}`);
  await speak
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(deniedReads, []);
  assert.equal(
    (
      await speaker.context.request.get(
        `${origin}/api/pictoflow/${foreignBase}/memory`,
      )
    ).status(),
    404,
  );
  for (const resource of Object.keys(foreignBefore))
    assert.deepEqual(
      await call(foreignBase + "/" + resource),
      foreignBefore[resource],
    );
  assert.deepEqual(errors, []);
  mark(
    "An identical pictogram with another person's accepted meaning never leaks into this journey; the unassigned profile stays unchanged",
  );
  report.status = "passed";
  console.log(
    `Complete authenticated POC journey passed: ${report.checkpoints.length} checkpoints, UI-prepared keys, six touches, explicit correction, personal-memory reuse, refusal and profile isolation.`,
  );
} catch (error) {
  report.status = "failed";
  if (active)
    await active.screenshot({
      path: ".local/complete-journey/failure.png",
      fullPage: true,
    });
  throw error;
} finally {
  await fs.writeFile(
    ".local/complete-journey/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await admin.dispose();
}
