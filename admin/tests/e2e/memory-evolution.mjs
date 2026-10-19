import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request, expect } from "@playwright/test";

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
  await call("profiles", "POST", {
    display_name: "Mémoire personnelle fictive",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre mémoire fictive" })
).id;
const privateProfile = (
  await call("profiles", "POST", { display_name: "Profil confidentiel fictif" })
).id;
const base = `profiles/${p}`;
const user = await call("auth/users", "POST", {
  username: "evolution-ci-user",
  display_name: "Suivi fictif",
  password,
});
const grant = `auth/users/${user.id}/profiles/${p}/capabilities`;
await call(grant, "PUT", {
  capabilities: ["view_history"],
  expected_capabilities: null,
});
await call(`auth/users/${user.id}/profiles/${other}/capabilities`, "PUT", {
  capabilities: ["review_meanings"],
  expected_capabilities: null,
});
const blocks = {};
for (const [label, key] of [
  ["Maman", "mother"],
  ["Papa", "father"],
  ["Boire", "drink"],
  ["Eau", "water"],
  ["Maison", "home"],
  ["Livre", "book"],
]) {
  const value = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label,
    pictogram_key: key,
    actor_role: "user",
  });
  blocks[key] = value.id;
  await call(base + `/blocks/${value.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
}
async function propose(keys) {
  const sequence = await call(base + "/sequences", "POST", {
    session_id: crypto.randomUUID(),
  });
  for (const key of keys)
    await call(base + `/sequences/${sequence.id}/selection`, "POST", {
      action: "append",
      block_id: blocks[key],
    });
  await call(base + `/sequences/${sequence.id}/selection`, "POST", {
    action: "complete",
  });
  return (await call(base + `/sequences/${sequence.id}/interpret`, "POST", {}))
    .candidates[0];
}
const old = await propose([
  "mother",
  "father",
  "drink",
  "water",
  "home",
  "water",
]);
const refused = await propose(["book"]);
await call(base + `/interpretations/${refused.id}/feedback`, "POST", {
  action: "reject",
  actor_role: "user",
});
const pending = await propose(["home"]);
const beforeKeyboard = await call(base + "/keyboard");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
const errors = [];
const writes = [];
const reads = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (req) => {
  if (!req.url().includes("/api/pictoflow/profiles/")) return;
  if (req.method() === "GET") reads.push(req.url());
  else writes.push(req.url());
});
const historyURL = `${origin}/accompagnement/personnes/${p}/historique`;
const cards = page.locator(".memory-change");
async function refresh() {
  await page
    .getByRole("button", { name: "Actualiser l’évolution", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Actualiser l’évolution", exact: true }),
  ).toBeEnabled();
}
async function noOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
}
await fs.mkdir(".local/memory-evolution", { recursive: true });
try {
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page.goto(historyURL);
  await page
    .getByRole("heading", {
      name: "Aucune phrase retenue pour le moment",
      exact: true,
    })
    .waitFor();
  assert.equal(await cards.count(), 0);

  const feedback = base + `/interpretations/${old.id}/feedback`;
  await call(feedback, "POST", { action: "confirm", actor_role: "caregiver" });
  await call(feedback, "POST", {
    action: "correct",
    actor_role: "professional",
    corrected_value:
      "Je voudrais boire de l’eau à la maison avec maman et papa.",
  });
  await call(feedback, "POST", { action: "reject", actor_role: "user" });
  const preserved = await call(base + "/audit");
  await refresh();
  await expect(cards).toHaveCount(3);
  assert.deepEqual(await cards.locator("header h2").allTextContents(), [
    "Phrase retirée de la mémoire",
    "Phrase corrigée",
    "Phrase confirmée",
  ]);
  assert.deepEqual(
    await cards
      .first()
      .locator(".memory-touches .touch-word")
      .allTextContents(),
    ["Maman", "Papa", "Boire", "Eau", "Maison", "Eau"],
  );
  await expect(
    cards
      .first()
      .getByText("Je voudrais boire de l’eau à la maison avec maman et papa.", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(cards.locator(".memory-change-current strong")).toHaveText(
    Array(3).fill("Aujourd’hui : phrase refusée ou retirée"),
  );
  await expect(cards.nth(1).getByText(old.text, { exact: true })).toBeVisible();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirmer cette phrase", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByText("Livre", { exact: true }).count(), 0);
  assert.equal(await page.locator("pre,.identifier").count(), 0);
  const times = await cards
    .locator("header time")
    .evaluateAll((nodes) => nodes.map((node) => Date.parse(node.dateTime)));
  assert(
    times.every((value, index) => index === 0 || times[index - 1] >= value),
  );
  await cards
    .first()
    .getByText("Voir les décisions humaines", { exact: true })
    .click();
  await expect(cards.first().locator(".memory-evidence li")).toHaveCount(3);
  await expect(
    cards
      .first()
      .locator(".memory-evidence")
      .getByText("Professionnel", { exact: false }),
  ).toBeVisible();
  assert.deepEqual(await call(base + "/audit"), preserved);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  assert.equal(
    (await call(base + `/interpretations/${pending.id}`)).status,
    "proposed",
  );

  const kept = await propose(["water"]);
  await call(base + `/interpretations/${kept.id}/feedback`, "POST", {
    action: "correct",
    actor_role: "caregiver",
    corrected_value: "De l’eau, s’il te plaît.",
  });
  await refresh();
  await expect(cards).toHaveCount(4);
  await expect(
    cards
      .first()
      .locator(".memory-change-current")
      .getByText("De l’eau, s’il te plaît.", { exact: true }),
  ).toBeVisible();
  await noOverflow();
  await page.screenshot({
    path: ".local/memory-evolution/history-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.screenshot({ path: ".local/memory-evolution/history-mobile.png" });
  await page.goto(`${origin}/accompagnement/personnes/${p}`);
  const preview = page.getByRole("region", {
    name: "Évolution de la mémoire",
    exact: true,
  });
  await expect(preview.locator(".memory-change")).toHaveCount(3);
  await preview
    .getByRole("link", { name: "Voir toute l’évolution", exact: true })
    .click();
  await expect(page).toHaveURL(historyURL);
  await expect(cards).toHaveCount(4);

  // A read failure hides the stale current state and requires an explicit successful refresh.
  await page.route(`**/api/pictoflow/${base}/interpretations`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await refresh();
  await page
    .getByText(
      "L’évolution de la mémoire ne peut pas être vérifiée. Actualisez pour retrouver les décisions et leur état actuel.",
      { exact: true },
    )
    .waitFor();
  await expect(cards).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await refresh();
  await expect(cards).toHaveCount(4);

  // More than one page of real, explicit corrections; never truncate to old audit events.
  for (let index = 1; index <= 20; index++)
    await call(base + `/interpretations/${kept.id}/feedback`, "POST", {
      action: "correct",
      actor_role: "professional",
      corrected_value: `Phrase quotidienne validée ${index}.`,
    });
  const allHistory = await call(
    base + "/audit?newest_first=true&meaning_changes_only=true&limit=1000",
  );
  await refresh();
  await expect(cards).toHaveCount(20);
  await expect(cards.first().locator(".memory-change-text").last()).toHaveText(
    "Phrase quotidienne validée 20.",
  );
  await page
    .getByRole("button", {
      name: "Voir les décisions plus anciennes",
      exact: true,
    })
    .click();
  await expect(cards).toHaveCount(allHistory.length);
  await expect(
    page.getByRole("button", {
      name: "Voir les décisions plus anciennes",
      exact: true,
    }),
  ).toHaveCount(0);
  assert.deepEqual(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.eventId),
    ),
    allHistory.map((event) => event.id),
  );
  assert.deepEqual(
    await call(
      base + "/audit?newest_first=true&meaning_changes_only=true&limit=1000",
    ),
    allHistory,
  );
  assert.deepEqual(await call(base + "/keyboard"), beforeKeyboard);
  assert.deepEqual(writes, []);

  // Direct URLs cannot mount history loaders for ungranted or review-only profiles.
  for (const [id, expectedStatus] of [
    [other, 403],
    [privateProfile, 404],
  ]) {
    const countBefore = reads.filter((url) =>
      url.includes(`profiles/${id}/`),
    ).length;
    await page.goto(`${origin}/accompagnement/personnes/${id}/historique`);
    await page
      .getByRole("heading", {
        name: "Ce profil ou cet écran ne vous est pas accessible.",
        exact: true,
      })
      .waitFor();
    assert.equal(
      reads.filter((url) => url.includes(`profiles/${id}/`)).length,
      countBefore,
    );
    assert.equal(
      (
        await page.request.get(
          `${origin}/api/pictoflow/profiles/${id}/audit?meaning_changes_only=true&newest_first=true`,
        )
      ).status(),
      expectedStatus,
    );
  }
  await call(grant, "PUT", {
    capabilities: ["review_meanings"],
    expected_capabilities: ["view_history"],
  });
  const beforeRevoke = reads.filter((url) =>
    url.includes(`profiles/${p}/audit`),
  ).length;
  await page.goto(historyURL);
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  await page.goto(`${origin}/accompagnement/personnes/${p}`);
  await page
    .getByRole("heading", { name: "Mémoire personnelle fictive", exact: true })
    .waitFor();
  assert.equal(
    reads.filter((url) => url.includes(`profiles/${p}/audit`)).length,
    beforeRevoke,
  );
  await expect(
    page.getByRole("region", { name: "Évolution de la mémoire", exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Memory evolution verified: actual accepted/corrected/withdrawn history, current state, six ordered pictograms including repetition, evidence roles, read-only access, empty state, pagination, read outage, profile isolation and revocation.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/memory-evolution/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
