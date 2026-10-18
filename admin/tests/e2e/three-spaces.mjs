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
async function profile(name) {
  const value = await call("profiles", "POST", { display_name: name });
  const base = `profiles/${value.id}`;
  const block = await call(base + "/blocks/personal", "POST", {
    request_id: crypto.randomUUID(),
    label: "Eau",
    pictogram_key: "water",
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, "POST", {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  await call(base + `/keyboard/${block.id}`, "PUT", {
    zone: "stable",
    position: 0,
    actor_role: "user",
  });
  return { ...value, block };
}
const p = await profile("Camille fictif");
const q = await profile("Alex fictif");
const privateProfile = await profile("Profil privé fictif");
async function account(name, grants) {
  const user = await call("auth/users", "POST", {
    username: `spaces-ci-${name}`,
    display_name: `Compte fictif ${name}`,
    password,
  });
  for (const [id, capabilities] of grants)
    await call(`auth/users/${user.id}/profiles/${id}/capabilities`, "PUT", {
      capabilities,
      expected_capabilities: null,
    });
  return user;
}
const single = await account("single", [
  [p.id, ["communicate", "review_meanings"]],
]);
const multiple = await account("multiple", [
  [p.id, ["communicate"]],
  [q.id, ["communicate"]],
]);
const mixed = await account("mixed", [
  [p.id, ["communicate"]],
  [q.id, ["prepare_keyboard", "communicate"]],
]);
const exporter = await account("export", [[p.id, ["export_profile"]]]);
const manager = await account("meaning", [[p.id, ["manage_meanings"]]]);
const empty = await account("empty", []);
const browser = await chromium.launch({ headless: true });
const errors = [];
let page;
await fs.mkdir(".local/three-spaces", { recursive: true });
async function connect(username, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin + "/");
  await page.getByLabel("Identifiant", { exact: true }).fill(username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  return context;
}
async function noOverflow() {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
}
async function deniedWithoutProfileReads(path) {
  const reads = [];
  const listener = (request) => {
    if (request.url().includes("/api/pictoflow/profiles/"))
      reads.push(request.url());
  };
  page.on("request", listener);
  await page.goto(origin + path);
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(reads, [], "Denied page must not mount its data loaders");
  assert.equal(await page.locator(".app-shell,.support-shell").count(), 0);
  page.off("request", listener);
}
try {
  let context = await connect("capability-ci-admin", 1280);
  await expect(page).toHaveURL(origin + "/admin");
  await page
    .getByRole("heading", { name: "Piloter PictoFlow", exact: true })
    .waitFor();
  await expect(
    page.getByRole("link", { name: "Comptes et accès", exact: true }).first(),
  ).toBeVisible();
  await noOverflow();
  await page.screenshot({
    path: ".local/three-spaces/admin.png",
    fullPage: true,
  });
  await context.close();

  context = await connect(single.username, 1024);
  await expect(page).toHaveURL(`${origin}/communication/${p.id}`);
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
  assert.equal(await page.locator(".app-shell,.support-shell").count(), 0);
  await page
    .locator(".communication-keyboard")
    .getByRole("button", { name: "Eau", exact: true })
    .click();
  await page
    .locator(".message-panel")
    .getByText("Eau", { exact: true })
    .waitFor();
  const reference = await page.evaluate(
    (id) => JSON.parse(sessionStorage.getItem(`pictoflow:sequence:${id}`)),
    p.id,
  );
  assert(reference.sequence_id);
  const before = await call(
    `profiles/${p.id}/sequences/${reference.sequence_id}`,
  );
  await page.goto(`${origin}/admin/profiles/${p.id}/communication`);
  await expect(page).toHaveURL(`${origin}/communication/${p.id}`);
  await page
    .locator(".message-panel")
    .getByText("Eau", { exact: true })
    .waitFor();
  assert.deepEqual(
    (await call(`profiles/${p.id}/sequences/${before.id}`)).block_ids,
    [p.block.id],
  );
  await noOverflow();
  await page.screenshot({
    path: ".local/three-spaces/communication-tablet.png",
    fullPage: true,
  });
  await deniedWithoutProfileReads(`/admin/profiles/${p.id}/keyboard`);
  await page
    .getByRole("link", { name: "Retrouver mon espace", exact: true })
    .click();
  await expect(page).toHaveURL(`${origin}/communication/${p.id}`);
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
  await deniedWithoutProfileReads(`/communication/${privateProfile.id}`);
  await page.goto(`${origin}/admin/profiles/${p.id}/memory`);
  await expect(page).toHaveURL(`${origin}/communication/${p.id}/memoire`);
  await page
    .getByRole("heading", { name: "Ma mémoire de communication", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("navigation", { name: "Navigation principale", exact: true })
      .count(),
    0,
  );
  await context.close();

  context = await connect(multiple.username);
  await expect(page).toHaveURL(origin + "/communication");
  await page
    .getByRole("heading", { name: "Choisir mon clavier", exact: true })
    .waitFor();
  await expect(page.locator(".person-card")).toHaveCount(2);
  assert.equal(
    await page.getByText("Profil privé fictif", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Administration", exact: true })
      .count(),
    0,
  );
  await noOverflow();
  await page.screenshot({
    path: ".local/three-spaces/chooser-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".person-card")
    .filter({ hasText: q.display_name })
    .click();
  await expect(page).toHaveURL(`${origin}/communication/${q.id}`);
  await context.close();

  context = await connect(mixed.username);
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page
    .getByRole("heading", {
      name: "Les personnes que j’accompagne",
      exact: true,
    })
    .waitFor();
  await expect(page.locator(".person-card")).toHaveCount(1);
  await page
    .locator(".person-card")
    .filter({ hasText: q.display_name })
    .click();
  await page
    .getByRole("heading", { name: q.display_name, exact: true })
    .waitFor();
  await page
    .getByRole("region", {
      name: "Aperçu du clavier de communication",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Administration", exact: true })
      .count(),
    0,
  );
  await noOverflow();
  await page.screenshot({
    path: ".local/three-spaces/support-mobile.png",
    fullPage: true,
  });
  await page.goto(`${origin}/admin/profiles/${q.id}/keyboard?resume=1`);
  await expect(page).toHaveURL(
    `${origin}/accompagnement/personnes/${q.id}/clavier?resume=1`,
  );
  await page
    .getByRole("heading", { name: "Ajouter le mot qui me manque", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Reprendre mon message", exact: true })
    .click();
  await page
    .locator(".communication-keyboard")
    .getByRole("button", { name: "Eau", exact: true })
    .click();
  await page
    .locator(".message-panel")
    .getByText("Eau", { exact: true })
    .waitFor();
  const qReference = await page.evaluate(
    (id) => JSON.parse(sessionStorage.getItem(`pictoflow:sequence:${id}`)),
    q.id,
  );
  await page
    .getByRole("link", { name: "Il me manque un mot", exact: true })
    .click();
  await expect(page).toHaveURL(
    `${origin}/accompagnement/personnes/${q.id}/clavier?resume=1`,
  );
  await page
    .getByRole("link", { name: "Reprendre mon message", exact: true })
    .click();
  await page
    .locator(".message-panel")
    .getByText("Eau", { exact: true })
    .waitFor();
  assert.deepEqual(
    (await call(`profiles/${q.id}/sequences/${qReference.sequence_id}`))
      .block_ids,
    [q.block.id],
  );
  await deniedWithoutProfileReads(`/accompagnement/personnes/${p.id}/clavier`);
  await context.close();

  context = await connect(exporter.username);
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page.locator(".person-card").click();
  await page
    .getByRole("heading", { name: p.display_name, exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("region", {
        name: "Aperçu du clavier de communication",
        exact: true,
      })
      .count(),
    0,
  );
  await page.goto(`${origin}/accompagnement/personnes/${p.id}/sauvegarde`);
  await page
    .getByRole("heading", { name: "Sauvegarder ce profil", exact: true })
    .waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Télécharger la sauvegarde", exact: true })
      .click(),
  ]);
  assert.equal(await download.failure(), null);
  await deniedWithoutProfileReads(`/accompagnement/personnes/${p.id}/clavier`);
  await context.close();

  context = await connect(manager.username);
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page.goto(`${origin}/admin/profiles/${p.id}/concepts`);
  await expect(page).toHaveURL(
    `${origin}/accompagnement/personnes/${p.id}/vocabulaire`,
  );
  await page
    .getByRole("heading", { name: "Vocabulaire personnel", exact: true })
    .waitFor();
  await expect(
    page.getByRole("heading", { name: "Eau", exact: true }),
  ).toBeVisible();
  assert.equal(await page.locator("pre,.identifier").count(), 0);
  await page
    .getByLabel("Mot ou sens personnel", { exact: true })
    .fill("Mon verre fictif");
  await page
    .getByRole("button", { name: "Ajouter au vocabulaire", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Mon verre fictif", exact: true })
    .waitFor();
  const meanings = (await call(`profiles/${p.id}/concepts`)).filter(
    (item) => item.label === "Mon verre fictif",
  );
  assert.equal(meanings.length, 1);
  assert.equal(meanings[0].profile_id, p.id);
  assert.equal(
    await page.getByText(meanings[0].canonical_key, { exact: true }).count(),
    0,
  );
  await context.close();

  context = await connect(empty.username);
  await expect(page).toHaveURL(origin + "/communication");
  await page
    .getByRole("heading", {
      name: "Aucun clavier attribué pour le moment",
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".person-card").count(), 0);
  await noOverflow();
  await page.screenshot({
    path: ".local/three-spaces/no-access-mobile.png",
    fullPage: true,
  });
  await context.close();
  assert.deepEqual(errors, []);
  console.log(
    "Three authenticated spaces verified: actual-grant landing, mixed/multiple/empty accounts, independent shells, legacy aliases, live API boundaries, mobile/tablet layout and preserved drafts.",
  );
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({
      path: ".local/three-spaces/failure.png",
      fullPage: true,
    });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
