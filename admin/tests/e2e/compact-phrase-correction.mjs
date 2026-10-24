import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";

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
    display_name: "Correction compacte fictive",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre correction fictive" })
).id;
const base = `profiles/${profile}`;
async function touch(label, drawing, position) {
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: drawing,
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    confirm_representation: true,
    actor_role: "user",
  });
  await call(base + `/keyboard/${block.id}`, "PUT", {
    zone: "personal",
    position,
    actor_role: "user",
  });
  return block;
}
const mother = await touch("Maman", "mother", 0);
const water = await touch("Eau", "water", 1);
const book = await touch("Livre", "book", 2);
async function draft(ids) {
  let sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  for (const block_id of ids)
    sequence = await call(
      base + `/sequences/${sequence.id}/selection`,
      "POST",
      { action: "append", block_id },
    );
  return sequence;
}
const originalIds = [mother.id, water.id, book.id, water.id];
let source = await draft(originalIds);
source = await call(base + `/sequences/${source.id}/selection`, "POST", {
  action: "complete",
});
const decision = await call(
  base + `/sequences/${source.id}/interpret`,
  "POST",
  {},
);
source = await call(base + `/sequences/${source.id}`);
const account = await call("auth/users", "POST", {
  username: "compact-phrase-correction-ci",
  display_name: "Correction communicant fictif",
  password,
});
for (const id of [profile, other])
  await call(`auth/users/${account.id}/profiles/${id}/capabilities`, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: null,
  });
const before = {};
for (const resource of ["memory", "keyboard", "blocks", "representations"])
  before[resource] = await call(base + "/" + resource);
async function nextProposal() {
  let sequence = await draft(originalIds);
  sequence = await call(base + `/sequences/${sequence.id}/selection`, "POST", {
    action: "complete",
  });
  const decision = await call(
    base + `/sequences/${sequence.id}/interpret`,
    "POST",
    {},
  );
  return { sequence, decision };
}
const browser = await chromium.launch({ headless: true });
let page;
const report = {
  status: "running",
  viewports: [],
  preview_writes: 0,
  feedback_requests: 0,
  model_requests: 0,
};
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [],
    writes = [],
    spoken = [];
  await page.exposeFunction("__recordSpeech", (text) => spoken.push(text));
  await page.addInitScript(() => {
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
          },
        ],
        speak(u) {
          void window.__recordSpeech(u.text);
          u.onstart?.();
        },
        cancel() {},
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (
      req.url().includes(`/api/pictoflow/${base}/`) &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method())
    ) {
      writes.push({
        path: new URL(req.url()).pathname,
        body: req.postDataJSON(),
      });
      if (req.url().endsWith("/feedback")) report.feedback_requests++;
      if (req.url().endsWith("/interpret")) report.model_requests++;
    }
  });
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(account.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  async function openProposal(sequence, decision) {
    await page.evaluate(
      ({ profile, sequence, decision }) => {
        localStorage.removeItem(`pictoflow:automatic:${profile}`);
        sessionStorage.setItem(
          `pictoflow:sequence:${profile}`,
          JSON.stringify({
            sequence_id: sequence.id,
            decision: {
              state: decision.state,
              candidate_ids: decision.candidates.map((c) => c.id),
            },
          }),
        );
      },
      { profile, sequence, decision },
    );
    await page.goto(`${origin}/communication/${profile}`);
    await expect(
      page.locator(".compact-formulation .proposed-phrase"),
    ).toHaveText(decision.candidates[0].text);
  }
  await openProposal(source, decision);
  const surface = page.locator(".compact-communication");
  const change = surface.getByRole("button", { name: "Changer", exact: true });
  const phrase = surface.locator(".proposed-phrase");
  const dialog = page.getByRole("dialog", {
    name: "Changer la phrase",
    exact: true,
  });
  const input = dialog.getByRole("textbox");
  const keep = dialog.getByRole("button", {
    name: "Garder le message actuel",
    exact: true,
  });
  const verify = dialog.getByRole("button", {
    name: "Vérifier ma correction",
    exact: true,
  });
  const edit = dialog.getByRole("button", {
    name: "Modifier mon texte",
    exact: true,
  });
  const save = dialog.getByRole("button", {
    name: "Enregistrer mon sens",
    exact: true,
  });
  const custom = "Maman, je voudrais lire mon livre et boire de l’eau.";
  // Communication alone never grants the right to alter accepted personal meaning.
  await expect(change).toBeDisabled();
  assert.equal(writes.length, 0);
  await call(
    `auth/users/${account.id}/profiles/${profile}/capabilities`,
    "PUT",
    {
      capabilities: ["communicate", "review_meanings"],
      expected_capabilities: ["communicate"],
    },
  );
  await page.reload();
  await expect(change).toBeEnabled();
  await change.press("Enter");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(decision.candidates[0].text);
  await expect(dialog.locator(".message-order-touch .touch-word")).toHaveText([
    "Maman",
    "Eau",
    "Livre",
    "Eau",
  ]);
  await expect(dialog.locator("svg")).toHaveCount(4);
  await input.fill("   ");
  await expect(verify).toBeDisabled();
  await input.fill("  " + custom + "  ");
  await verify.click();
  await expect(keep).toBeFocused();
  await expect(input).toHaveValue(custom);
  assert(await input.evaluate((n) => n.readOnly));
  await expect(dialog.locator(".correction-original")).toHaveText(
    decision.candidates[0].text,
  );
  await edit.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("  " + custom + "  ");
  await input.fill(
    custom +
      " " +
      "Une phrase personnelle longue pour vérifier la relecture. ".repeat(6),
  );
  await verify.click();
  await fs.mkdir(".local/compact-phrase-correction", { recursive: true });
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(keep).toBeVisible();
    assert(
      await input.evaluate((n) => n.scrollTop <= 1 && n.selectionStart === 0),
      "Review must start at the first words after editing and reflow",
    );
    assert(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1));
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.local/compact-phrase-correction/review-${width}.png`,
      fullPage: true,
    });
    report.viewports.push(width);
  }
  await page.waitForTimeout(1500);
  assert.equal(writes.length, 0);
  assert.equal(report.model_requests, 0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(change).toBeFocused();
  assert.deepEqual(await call(base + "/memory"), before.memory);

  // An unsuccessful response retains the draft; only a deliberate retry writes.
  await change.click();
  await input.fill(custom);
  await verify.click();
  const feedbackURL = `**/api/pictoflow/${base}/interpretations/*/feedback`;
  await page.route(feedbackURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic feedback outage" },
    }),
  );
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("n’a pas été confirmé");
  await expect(input).toHaveValue(custom);
  await expect(save).toBeEnabled();
  assert.equal(report.feedback_requests, 1);
  assert.deepEqual(await call(base + "/memory"), before.memory);
  await page.unroute(feedbackURL);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let pending = 0;
  await page.route(feedbackURL, async (route) => {
    pending++;
    await held;
    await route.continue();
  });
  await save.press("Enter");
  await expect.poll(() => pending).toBe(1);
  for (const control of [input, keep, edit, save])
    await expect(control).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText(
    "Enregistrement en cours…",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  // Exercise the synchronous guard in addition to disabled native controls.
  await dialog
    .locator("form")
    .evaluate((n) =>
      n.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  await save.evaluate((n) => n.click());
  release();
  await expect(dialog).toHaveCount(0);
  await expect(phrase).toHaveText(custom);
  await expect(
    surface.getByRole("heading", { name: "Mon message", exact: true }),
  ).toBeFocused();
  assert.equal(pending, 1);
  assert.equal(report.feedback_requests, 2);
  assert.deepEqual(writes[1].body, {
    action: "correct",
    actor_role: "user",
    expected_status: "proposed",
    corrected_value: custom,
  });
  await page.unroute(feedbackURL);
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  const saved = await call(
    base + `/interpretations/${decision.candidates[0].id}`,
  );
  assert.equal(saved.status, "corrected");
  assert.equal(saved.corrected_text, custom);
  assert.equal((await call(base + "/memory")).interpretations.length, 1);

  // A committed response lost in transit is reread, never automatically replayed.
  const lost = await nextProposal();
  await openProposal(lost.sequence, lost.decision);
  await change.click();
  const lostText = "Je veux lire avec Maman.";
  await input.fill(lostText);
  await verify.click();
  let lostRequests = 0;
  await page.route(feedbackURL, async (route) => {
    lostRequests++;
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await save.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("déjà été traitée");
  await expect(input).toHaveValue(lostText);
  await expect(save).toBeDisabled();
  await expect(phrase).toHaveText(lostText);
  assert.equal(lostRequests, 1);
  assert.equal(report.feedback_requests, 3);
  assert.equal((await call(base + "/memory")).interpretations.length, 2);
  await keep.click();
  await expect(dialog).toHaveCount(0);
  await page.unroute(feedbackURL);

  // Another session rejects the captured proposal: status guard prevents overwrite.
  const stale = await nextProposal();
  await openProposal(stale.sequence, stale.decision);
  await change.click();
  await input.fill("Cette correction doit rester un brouillon.");
  await verify.click();
  await call(
    base + `/interpretations/${stale.decision.candidates[0].id}/feedback`,
    "POST",
    { action: "reject", actor_role: "user" },
  );
  await save.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("déjà été traitée");
  assert.equal(
    (await call(base + `/interpretations/${stale.decision.candidates[0].id}`))
      .status,
    "rejected",
  );
  assert.equal(report.feedback_requests, 4);
  assert.equal((await call(base + "/memory")).interpretations.length, 2);
  await keep.click();

  const offline = await nextProposal();
  await openProposal(offline.sequence, offline.decision);
  await change.click();
  await input.fill("Mon brouillon reste local.");
  await page.context().setOffline(true);
  await verify.click();
  await expect(save).toBeDisabled();
  await expect(keep).toBeEnabled();
  await keep.click();
  await expect(change).toBeDisabled();
  await page.context().setOffline(false);
  await expect(change).toBeEnabled();
  assert.equal(report.feedback_requests, 4);
  await change.click();
  await expect(input).toHaveValue(offline.decision.candidates[0].text);
  await input.fill("Un texte qui ne doit pas passer au profil suivant.");
  await page.goto(`${origin}/communication/${other}`);
  await expect(dialog).toHaveCount(0);
  await page.goto(`${origin}/communication/${profile}`);
  await expect(dialog).toHaveCount(0);
  await change.click();
  await expect(input).toHaveValue(offline.decision.candidates[0].text);
  await input.fill("Un autre brouillon local.");
  await page.reload();
  await expect(dialog).toHaveCount(0);
  await change.click();
  await expect(input).toHaveValue(offline.decision.candidates[0].text);
  await keep.click();
  assert.equal(report.feedback_requests, 4);
  assert.equal(report.model_requests, 0);
  assert(writes.every((w) => w.path.endsWith("/feedback")));
  for (const resource of ["keyboard", "blocks", "representations"])
    assert.deepEqual(await call(base + "/" + resource), before[resource]);
  assert.deepEqual(await call(base + `/sequences/${source.id}`), source);
  assert.deepEqual(spoken, []);
  assert.deepEqual(errors, []);
  report.status = "passed";
  console.log(
    "Compact correction verified: local edit/review, exact personal text and pictograms, explicit guarded feedback, pending Escape/double-submit protection, retained failed/lost/stale drafts without replay, unchanged selection/keyboard, offline dismissal and reload/profile reset.",
  );
} catch (error) {
  report.status = "failed";
  if (page) {
    await fs.mkdir(".local/compact-phrase-correction", { recursive: true });
    await page.screenshot({
      path: ".local/compact-phrase-correction/failure.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await fs.mkdir(".local/compact-phrase-correction", { recursive: true });
  await fs.writeFile(
    ".local/compact-phrase-correction/report.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await admin.dispose();
}
