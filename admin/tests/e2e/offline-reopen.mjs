import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request } from "@playwright/test";
const origin = "http://127.0.0.1:3130";
const api = await request.newContext({ baseURL: origin });
async function call(path, data) {
  const r =
    data === undefined
      ? await api.get("/api/pictoflow/" + path)
      : await api.post("/api/pictoflow/" + path, { data });
  assert(r.ok(), `${path}: ${r.status()}`);
  return r.json();
}
const browser = await chromium.launch({ headless: true });
try {
  const p = (await call("profiles", { display_name: "Réouverture fictive" }))
    .id;
  const base = `profiles/${p}`;
  for (const [label, drawing] of [
    ["Boire", "drink"],
    ["Eau", "water"],
  ]) {
    const block = await call(base + "/blocks/personal", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key: drawing,
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, {
      action: "confirm",
      actor_role: "user",
      confirm_representation: true,
    });
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "allow",
  });
  const errors = [];
  let ai = 0;
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  context.on("request", (r) => {
    if (r.url().endsWith("/interpret")) ai++;
  });
  let page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${origin}/communication/${p}`);
  await page
    .getByRole("button", { name: "Plus d’options", exact: true })
    .click();
  await page
    .getByText("Mon clavier pour les coupures", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Préparer mon clavier", exact: true })
    .click();
  const setup = page.getByRole("region", {
    name: "Réouverture sans réseau",
    exact: true,
  });
  const secret = "ma copie fictive pour le sport";
  await setup
    .getByLabel("Phrase secrète de la copie hors connexion", { exact: true })
    .fill(secret);
  await setup
    .getByLabel("Confirmer la phrase secrète", { exact: true })
    .fill(secret);
  await setup
    .getByRole("button", {
      name: "Préparer la réouverture protégée",
      exact: true,
    })
    .click();
  await setup
    .getByText("L’écran et la copie protégée sont prêts.", { exact: false })
    .waitFor();
  const cached = await page.evaluate(async () => {
    const result = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        result.push(new URL(request.url).pathname);
    return result;
  });
  assert(cached.includes("/offline"));
  assert(
    cached.every(
      (path) =>
        path === "/offline" ||
        path === "/offline-active" ||
        path.startsWith("/_next/static/"),
    ),
  );
  await page.close();
  await context.setOffline(true);
  async function open() {
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(origin + "/offline");
    await page
      .getByRole("heading", { name: "Mon clavier hors connexion", exact: true })
      .waitFor();
    await page
      .getByLabel("Copie enregistrée", { exact: true })
      .selectOption({ index: 1 });
  }
  async function unlock(password = secret) {
    await page.getByLabel("Ma phrase secrète", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Déverrouiller ma copie", exact: true })
      .click();
  }
  await open();
  assert.equal(
    await page.getByRole("button", { name: "Boire", exact: true }).count(),
    0,
  );
  await unlock("une mauvaise phrase de test");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Boire", exact: true }).count(),
    0,
  );
  await unlock();
  const unlocked = () =>
    page.getByRole("region", { name: "Ma copie déverrouillée", exact: true });
  await unlocked().getByRole("button", { name: "Boire", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".memory-phrase")?.textContent === "Boire",
  );
  await unlocked().getByRole("button", { name: "Eau", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".memory-phrase")?.textContent === "Boire Eau",
  );
  await page.close();
  await open();
  await unlock();
  await page.waitForFunction(
    () => document.querySelector(".memory-phrase")?.textContent === "Boire Eau",
  );
  await page.setViewportSize({ width: 320, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await fs.mkdir(".local/offline-reopen", { recursive: true });
  await unlocked().screenshot({
    path: ".local/offline-reopen/reopened-mobile.png",
  });
  await context.setOffline(false);
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        account: {
          id: crypto.randomUUID(),
          active: true,
          is_admin: true,
          profile_access: {},
        },
        csrf_token: "synthetic",
      },
    }),
  );
  await page
    .getByLabel("Je souhaite enregistrer ce message au retour du réseau", {
      exact: false,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Vérifier mes accès et enregistrer",
      exact: true,
    })
    .click();
  await page
    .getByText("Reconnectez-vous en ligne avec le compte", { exact: false })
    .waitFor();
  assert.equal((await call(base + "/sequences")).length, 0);
  await page.unroute("**/auth/session");
  let lost = false;
  await page.route("**/offline-drafts", async (route) => {
    if (!lost) {
      lost = true;
      const r = await route.fetch();
      assert(r.ok());
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page
    .getByRole("button", {
      name: "Vérifier mes accès et enregistrer",
      exact: true,
    })
    .click();
  await page
    .getByText("L’enregistrement n’a pas été confirmé.", { exact: false })
    .waitFor();
  assert.equal((await call(base + "/sequences")).length, 1);
  await page
    .getByLabel("Je souhaite enregistrer ce message au retour du réseau", {
      exact: false,
    })
    .check();
  await page
    .getByRole("button", {
      name: "Vérifier le même enregistrement",
      exact: true,
    })
    .click();
  await page
    .getByText("Le message est enregistré sur le serveur.", { exact: false })
    .waitFor();
  assert.equal((await call(base + "/sequences")).length, 1);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  const online = await context.newPage();
  // Exercise actual local logout cleanup and the other tab's lock with a synthetic account view.
  await online.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        account: {
          id: crypto.randomUUID(),
          display_name: "Compte fictif",
          active: true,
          is_admin: true,
          profile_access: {},
        },
        csrf_token: null,
      },
    }),
  );
  await online.goto(`${origin}/communication/${p}`);
  await online
    .getByRole("button", {
      name: "Se déconnecter et effacer les copies locales",
      exact: true,
    })
    .click();
  await online
    .getByRole("heading", { name: "Se connecter à PictoFlow", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Ouvrir ma copie protégée", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Boire", exact: true }).count(),
    0,
  );
  assert.equal(
    await online.evaluate(async () =>
      (await indexedDB.databases()).some(
        (db) => db.name === "pictoflow-offline-vault-v1",
      ),
    ),
    false,
  );
  assert.deepEqual(await online.evaluate(() => caches.keys()), []);
  assert.equal(ai, 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Offline reopen verified: prepared shell, fresh offline navigation, protected unlock, durable draft, owner check, explicit idempotent import and logout cleanup across tabs.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
