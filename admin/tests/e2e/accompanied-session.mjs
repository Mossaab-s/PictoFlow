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
  await call("profiles", "POST", { display_name: "Clavier accompagné fictif" })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Autre personne fictive" })
).id;
const user = await call("auth/users", "POST", {
  username: "handoff-ci-user",
  display_name: "Adulte fictif",
  password,
});
const all = [
  "communicate",
  "review_meanings",
  "prepare_keyboard",
  "manage_meanings",
  "view_history",
  "export_profile",
];
for (const id of [p, other])
  await call(`auth/users/${user.id}/profiles/${id}/capabilities`, "PUT", {
    capabilities: all,
    expected_capabilities: null,
  });
const base = `profiles/${p}`;
const block = await call(base + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Eau",
  pictogram_key: "water",
  actor_role: "caregiver",
});
await call(base + `/blocks/${block.id}/feedback`, "POST", {
  action: "confirm",
  actor_role: "caregiver",
  confirm_representation: true,
});
const before = await call(base + "/keyboard");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1024, height: 900 },
});
// Exercise the storage-event fallback, independently of BroadcastChannel support.
await context.addInitScript(() => {
  window.BroadcastChannel = undefined;
});
const page = await context.newPage();
// This scenario exercises the detailed tools available from Options.
await page.addInitScript(() => {
  try {
    sessionStorage.setItem("pictoflow:communication-view", "tools");
  } catch {
    /* Optional UI preference. */
  }
});
const tab = await context.newPage();
// This scenario exercises the detailed tools available from Options.
await tab.addInitScript(() => {
  try {
    sessionStorage.setItem("pictoflow:communication-view", "tools");
  } catch {
    /* Optional UI preference. */
  }
});
const errors = [];
for (const current of [page, tab])
  current.on("pageerror", (error) => errors.push(error.message));
let handoffPosts = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().endsWith("/auth/accompanied"))
    handoffPosts++;
});
async function connect() {
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(origin + "/accompagnement");
}
async function handoff() {
  await page.goto(`${origin}/accompagnement/personnes/${p}`);
  await page
    .getByText("Confier le clavier à cette personne", { exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Démarrer la session accompagnée",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${origin}/communication/${p}`);
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
}
async function noOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
}
await fs.mkdir(".local/accompanied-session", { recursive: true });
try {
  await page.goto(origin + "/");
  await connect();
  await tab.goto(`${origin}/accompagnement/personnes/${other}/clavier`);
  await tab
    .getByRole("heading", { name: "Préparer mon clavier", exact: true })
    .waitFor();
  for (const current of [page, tab])
    await current.evaluate(async () => {
      sessionStorage.setItem(
        "pictoflow:sequence:synthetic",
        "old-adult-reference",
      );
      for (const [name, store] of [
        ["pictoflow-offline-v1", "profiles"],
        ["pictoflow-offline-vault-v1", "copies"],
      ]) {
        await new Promise((resolve, reject) => {
          const opening = indexedDB.open(name, 1);
          opening.onupgradeneeded = () =>
            opening.result.createObjectStore(store, {
              keyPath: store === "profiles" ? "profile_id" : "id",
            });
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).put({
              id: "synthetic-copy",
              profile_id: "synthetic-profile",
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error);
            };
          };
          opening.onerror = () => reject(opening.error);
        });
      }
      if ("caches" in globalThis)
        await (
          await caches.open("pictoflow-offline-shell-" + "a".repeat(64))
        ).put("/offline", new Response("synthetic offline shell"));
    });
  // Hold a previously authorized profile response across the scope transition.
  let release, captured;
  const held = new Promise((resolve) => {
    captured = resolve;
  });
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await tab.route(
    `**/api/pictoflow/profiles/${other}/keyboard`,
    async (route) => {
      const response = await route.fetch();
      captured();
      await wait;
      try {
        await route.fulfill({ response });
      } catch {
        /* Navigation can abort the old request. */
      }
    },
  );
  await tab.reload();
  await held;
  await page.goto(`${origin}/accompagnement/personnes/${p}`);
  await page
    .getByText("Confier le clavier à cette personne", { exact: true })
    .click();
  await page.screenshot({
    path: ".local/accompanied-session/handoff-tablet.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Démarrer la session accompagnée",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${origin}/communication/${p}`);
  await expect(tab).toHaveURL(`${origin}/communication/${p}`);
  release();
  await tab.unrouteAll({ behavior: "wait" });
  for (const current of [page, tab]) {
    await current
      .getByRole("heading", { name: "Je communique", exact: true })
      .waitFor();
    await expect(
      current.getByRole("heading", {
        name: "Préparer mon clavier",
        exact: true,
      }),
    ).toHaveCount(0);
    assert.equal(
      await current.evaluate(() =>
        sessionStorage.getItem("pictoflow:sequence:synthetic"),
      ),
      null,
    );
  }
  assert.equal(handoffPosts, 1);
  const value = await (
    await page.request.get(origin + "/api/pictoflow/auth/session")
  ).json();
  assert.equal(value.account.assisted_profile_id, p);
  assert.equal(value.account.is_admin, false);
  assert.deepEqual(Object.keys(value.account.profile_capabilities), [p]);
  const local = await page.evaluate(async () => ({
    dbs: (await indexedDB.databases()).map((db) => db.name),
    caches: await caches.keys(),
  }));
  assert(
    !local.dbs.includes("pictoflow-offline-v1") &&
      !local.dbs.includes("pictoflow-offline-vault-v1"),
  );
  assert(
    !local.caches.some((name) => name.startsWith("pictoflow-offline-shell-")),
  );
  for (const [path, status] of [
    ["auth/users", 403],
    [base + "/backup", 403],
    [`profiles/${other}/keyboard`, 404],
    [base + "/communication-snapshot", 403],
  ]) {
    assert.equal(
      (await page.request.get(origin + "/api/pictoflow/" + path)).status(),
      status,
    );
  }
  await page.goto(`${origin}/accompagnement/personnes/${other}/clavier`);
  await expect(page).toHaveURL(`${origin}/communication/${p}`);
  await page.goto("about:blank");
  await page.goBack();
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
  await page.goto(origin + "/offline");
  await page
    .getByRole("heading", { name: "Session accompagnée en ligne", exact: true })
    .waitFor();
  await expect(page.getByLabel("Phrase secrète", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("link", { name: "Revenir à PictoFlow", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/communication/${p}`);
  await page
    .locator(".communication-keyboard")
    .getByRole("button", { name: "Eau", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Terminer mon message", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await page
    .getByRole("button", { name: "C'est ce que je veux dire", exact: true })
    .click();
  await page
    .locator(".interpretation-card")
    .getByText("Mémoire validée", { exact: true })
    .waitFor();
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.screenshot({
    path: ".local/accompanied-session/communication-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Revenir à l’accompagnement — se reconnecter",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Se connecter à PictoFlow", exact: true })
    .waitFor();
  await tab
    .getByRole("heading", { name: "Se connecter à PictoFlow", exact: true })
    .waitFor();
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByText("Identifiant ou mot de passe incorrect.", { exact: true })
    .waitFor();
  await expect(
    page.getByRole("heading", { name: "Je communique", exact: true }),
  ).toHaveCount(0);
  await connect();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("pictoflow:accompanied")),
    null,
  );

  // A committed response with no usable body is reconciled by reading the server session once.
  await page.route("**/api/pictoflow/auth/accompanied", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: "" });
  });
  await handoff();
  assert.equal(handoffPosts, 2);
  await page.unrouteAll({ behavior: "wait" });
  // Revocation applies to this cookie without restoring any other profile's grants.
  await call(`auth/users/${user.id}/profiles/${p}/capabilities`, "PUT", {
    capabilities: ["view_history"],
    expected_capabilities: all,
  });
  await page.reload();
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  await expect(page.locator(".communication-keyboard")).toHaveCount(0);
  assert.equal(
    (
      await page.request.get(
        origin + `/api/pictoflow/profiles/${other}/keyboard`,
      )
    ).status(),
    404,
  );
  assert.deepEqual(await call(base + "/keyboard"), before);
  assert.deepEqual(errors, []);
  console.log(
    "Accompanied handoff: scoped cookie, multiple tabs without BroadcastChannel, late response, offline cleanup, back navigation, composition/review, reauthentication, empty response and revocation verified.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/accompanied-session/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
  await admin.dispose();
}
