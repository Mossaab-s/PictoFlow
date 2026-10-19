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
const profiles = [];
for (let i = 0; i < 11; i++)
  profiles.push(
    await call("profiles", "POST", {
      display_name: `Console fictive ${i === 0 ? "Émilie" : String(i).padStart(2, "0")}`,
    }),
  );
const p = profiles[0];
const base = `profiles/${p.id}`;
await call(base + "/concepts", "POST", {
  canonical_key: "CONSOLE_WATER",
  label: "Eau",
});
const limited = await call("auth/users", "POST", {
  username: "console-ci-limited",
  display_name: "Accompagnant fictif",
  password,
});
await call(`auth/users/${limited.id}/profiles/${p.id}/capabilities`, "PUT", {
  capabilities: ["prepare_keyboard"],
  expected_capabilities: null,
});
const before = {};
for (const name of ["audit", "memory", "blocks", "keyboard"])
  before[name] = await call(base + "/" + name);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
const writes = [];
const reads = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (req) => {
  if (!req.url().includes("/api/pictoflow/")) return;
  if (req.method() === "GET") reads.push(new URL(req.url()).pathname);
  else if (!req.url().includes("/auth/")) writes.push(req.url());
});
const nav = page.getByRole("navigation", {
  name: "Navigation principale",
  exact: true,
});
const button = (name) => page.getByRole("button", { name, exact: true });
async function noOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
}
async function selected(href) {
  await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute(
    "href",
    href,
  );
}
await fs.mkdir(".local/admin-console", { recursive: true });
try {
  await page.goto(origin + "/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill("capability-ci-admin");
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await button("Se connecter").click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await expect(page).toHaveURL(origin + "/admin");
  await expect(page.locator(".admin-service-grid")).toContainText(
    "Répond aux requêtes",
  );
  await expect(page.locator(".admin-service-grid")).toContainText(
    "Configuration déclarée",
  );
  assert(
    !reads.some((path) => path.endsWith("/providers")),
    "Overview must not contact the AI provider",
  );
  await selected("/admin");
  await noOverflow();
  await page.screenshot({
    path: ".local/admin-console/overview-desktop.png",
    fullPage: true,
  });
  await page.locator(".admin-skip-link").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#admin-content")).toBeFocused();

  // A failed readiness refresh must clear previously displayed success.
  const readinessURL = origin + "/api/pictoflow/readiness";
  await page.route(readinessURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic readiness outage" },
    }),
  );
  await button("Actualiser les services").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Certaines vérifications sont indisponibles" })
    .waitFor();
  await expect(page.locator(".admin-service-grid")).not.toContainText(
    "Configuration déclarée",
  );
  await expect(page.locator(".admin-service-grid")).toContainText(
    "État non vérifié",
  );
  await expect(page.locator(".admin-service-grid")).toContainText(
    "Répond aux requêtes",
  );
  await page.unroute(readinessURL);
  await button("Actualiser les services").click();
  await expect(page.locator(".admin-service-grid")).toContainText(
    "Configuration déclarée",
  );

  await nav
    .getByRole("link", { name: "Audit et diagnostics", exact: true })
    .click();
  await selected("/admin/audit");
  const search = page.getByLabel("Rechercher un profil pour l’audit", {
    exact: true,
  });
  await search.fill("Console fictive");
  await expect(page.locator(".admin-audit-profile")).toHaveCount(10);
  await button("Suivant").click();
  await expect(page.locator(".admin-audit-profile")).toHaveCount(1);
  await search.fill("emilie");
  const card = page.getByRole("article", { name: p.display_name, exact: true });
  await expect(page.locator(".admin-audit-profile")).toHaveCount(1);
  await card
    .getByRole("link", { name: "Ouvrir l’audit PCL", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/admin/profiles/${p.id}/audit`);
  await selected("/admin/audit");
  await page
    .getByRole("heading", { name: "Historique", exact: true })
    .waitFor();
  await expect(page.locator(".table-scroll")).toContainText("concept_created");
  await page.goto(origin + "/admin/audit");
  await search.fill("emilie");
  await card
    .getByRole("link", { name: "Voir la qualité IA", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/admin/profiles/${p.id}/ai-quality`);
  await selected("/admin/audit");
  await page
    .getByRole("heading", { name: "Qualité des propositions IA", exact: true })
    .waitFor();

  await page.goto(origin + "/admin/audit");
  await search.fill("Console fictive");
  await expect(page.locator(".admin-audit-profile")).toHaveCount(10);
  const listURL = origin + "/api/pictoflow/profiles";
  await page.route(listURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic profile outage" },
    }),
  );
  await button("Actualiser les profils d’audit").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Les profils ne peuvent pas être chargés" })
    .waitFor();
  assert.equal(await page.locator(".admin-audit-profile").count(), 0);
  await page.unroute(listURL);
  await button("Actualiser les profils d’audit").click();
  await expect(page.locator(".admin-audit-profile")).toHaveCount(10);

  await nav.getByRole("link", { name: "Fournisseur IA", exact: true }).click();
  await selected("/admin/providers");
  await expect(page.locator(".provider-card")).toContainText("disabled");
  const providerURL = origin + "/api/pictoflow/providers";
  await page.route(providerURL, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Synthetic provider outage" },
    }),
  );
  await button("Actualiser l’état").click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".provider-card").count(), 0);
  await page.unroute(providerURL);
  await button("Actualiser l’état").click();
  await expect(page.locator(".provider-card")).toContainText("disabled");

  await nav
    .getByRole("link", { name: "Sauvegarde et maintenance", exact: true })
    .click();
  await selected("/admin/maintenance");
  await expect(
    page.getByRole("link", {
      name: "Lire la procédure de sauvegarde serveur",
      exact: true,
    }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Mossaab-s/PictoFlow/blob/main/docs/SERVER_BACKUPS.md",
  );
  await expect(
    page.getByText(
      "La date et la réussite de la dernière sauvegarde serveur ne sont pas connues de cette console.",
      { exact: false },
    ),
  ).toBeVisible();
  assert.equal(await page.locator(".admin-maintenance-page button").count(), 0);
  await page
    .getByRole("link", {
      name: "Ouvrir la restauration de profil",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(origin + "/admin/restore-profile");
  await selected("/admin/maintenance");
  await page.goto(origin + "/admin/maintenance");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page
    .getByRole("heading", { name: "Sauvegarde et maintenance", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".local/admin-console/maintenance-mobile.png",
  });
  await page.goto(origin + "/admin/audit");
  await search.fill("emilie");
  await card.waitFor();
  await noOverflow();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".local/admin-console/audit-mobile.png" });
  assert.deepEqual(writes, [], "Console inspection must not modify PCL data");
  for (const name of Object.keys(before))
    assert.deepEqual(await call(base + "/" + name), before[name]);

  // Limited users cannot mount console loaders or read admin-only provider metadata.
  const context = await browser.newContext();
  const limitedPage = await context.newPage();
  limitedPage.on("pageerror", (error) => errors.push(error.message));
  await limitedPage.goto(origin + "/");
  await limitedPage
    .getByLabel("Identifiant", { exact: true })
    .fill(limited.username);
  await limitedPage.getByLabel("Mot de passe", { exact: true }).fill(password);
  await limitedPage
    .getByRole("button", { name: "Se connecter", exact: true })
    .click();
  await expect(limitedPage.locator(".account-bar")).toBeVisible();
  const deniedReads = [];
  limitedPage.on("request", (req) => {
    if (req.url().includes("/api/pictoflow/") && !req.url().includes("/auth/"))
      deniedReads.push(req.url());
  });
  for (const path of ["audit", "maintenance", "providers"]) {
    deniedReads.length = 0;
    await limitedPage.goto(`${origin}/admin/${path}`);
    await limitedPage
      .getByRole("heading", {
        name: "Ce profil ou cet écran ne vous est pas accessible.",
        exact: true,
      })
      .waitFor();
    assert.deepEqual(deniedReads, []);
    assert.equal(await limitedPage.locator(".app-shell").count(), 0);
  }
  assert.equal((await context.request.get(providerURL)).status(), 403);
  await context.close();

  // The existing local no-account mode keeps its console, without an account-management link.
  const local = await browser.newContext({
    viewport: { width: 1024, height: 900 },
  });
  const localPage = await local.newPage();
  localPage.on("pageerror", (error) => errors.push(error.message));
  await localPage.goto("http://127.0.0.1:3130/admin");
  await localPage
    .getByRole("heading", { name: "Piloter PictoFlow", exact: true })
    .waitFor();
  await expect(
    localPage.getByRole("link", { name: "Comptes et accès", exact: true }),
  ).toHaveCount(0);
  await localPage.goto("http://127.0.0.1:3130/admin/maintenance");
  await localPage
    .getByRole("heading", { name: "Sauvegarde et maintenance", exact: true })
    .waitFor();
  await local.close();
  assert.deepEqual(errors, []);
  console.log(
    "Admin console verified: real read-only services, unavailable-state recovery, scoped audit navigation/search/pagination, provider refresh, honest server procedures, limited-account denial, local no-account mode, mobile reflow and unchanged PCL.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/admin-console/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
