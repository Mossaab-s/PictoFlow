import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, request, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3132";
const password = "Synthetic capability CI passphrase";
const suffix = crypto.randomUUID().slice(0, 8);
const root = await request.newContext({
  baseURL: origin,
  extraHTTPHeaders: { Origin: origin },
});
const authenticated = await root.post("/api/pictoflow/auth/login", {
  data: { username: "capability-ci-admin", password },
});
assert(authenticated.ok());
const csrf = (await authenticated.json()).csrf_token;
async function call(path, method = "GET", data) {
  const response = await root.fetch("/api/pictoflow/" + path, {
    method,
    headers: { "X-CSRF-Token": csrf },
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.status() === 204 ? null : response.json();
}
async function account(kind, name) {
  return call("auth/users", "POST", {
    username: `roles-${name}-${suffix}`,
    display_name: `Fictif ${name}`,
    password,
    account_type: kind,
  });
}
const practitioner = await account("practitioner", "praticien");
const parent = await account("parent", "parent");
const patient = await account("patient", "patient");
const other = await account("patient", "autre-famille");
const full = [
  "communicate",
  "review_meanings",
  "prepare_keyboard",
  "manage_meanings",
  "view_history",
  "export_profile",
];
async function link(owner, dependent, capabilities) {
  await call(`auth/users/${owner.id}/links/${dependent.id}`, "PUT", {
    linked: true,
    expected_linked: false,
    capabilities,
    expected_capabilities: null,
  });
}
await link(practitioner, parent, null);
await link(practitioner, patient, full);
await link(parent, patient, full);
await link(parent, other, full); // Shared parent, explicitly outside this practitioner's scope.
const browser = await chromium.launch({ headless: true });
const errors = [];
const contexts = [];
async function connect(user) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel("Identifiant", { exact: true }).fill(user.username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  return page;
}
try {
  const page = await connect(practitioner);
  await expect(page).toHaveURL(origin + "/accompagnement");
  await page
    .getByRole("link", { name: "Comptes et rattachements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Comptes et accès", exact: true }),
  ).toBeVisible();
  const role = page.getByRole("combobox", {
    name: "Type de compte",
    exact: true,
  });
  await expect(role).toBeVisible();
  await expect(role.locator("option")).toHaveText(["Parent", "Patient"]);
  await expect(
    page.getByRole("article", { name: parent.display_name, exact: true }),
  ).toContainText("hors de votre périmètre");
  await expect(
    page.getByRole("article", { name: other.display_name, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Administration", exact: true }),
  ).toHaveCount(0);

  await role.selectOption("patient");
  const createdName = "Fictif patient créé dans l’écran";
  const createdLogin = `roles-created-${suffix}`;
  await page.getByLabel("Nom affiché", { exact: true }).fill(createdName);
  await page.getByLabel("Identifiant", { exact: true }).fill(createdLogin);
  await page.getByLabel("Mot de passe initial", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Créer le compte", exact: true })
    .click();
  const createdCard = page.getByRole("article", {
    name: createdName,
    exact: true,
  });
  await expect(
    createdCard.getByRole("link", { name: "Préparer le clavier", exact: true }),
  ).toBeVisible();
  const created = (await call("auth/users")).find(
    (user) => user.username === createdLogin,
  );
  assert(created?.patient_profile_id);
  const links = page.getByRole("region", {
    name: "Rattachements et droits",
    exact: true,
  });
  await links
    .getByRole("combobox", { name: "Compte qui gère", exact: true })
    .selectOption(parent.id);
  await links
    .getByRole("combobox", { name: "Personne rattachée", exact: true })
    .selectOption(created.id);
  await links
    .getByLabel("Exporter une sauvegarde du profil", { exact: true })
    .uncheck();
  await links
    .getByRole("button", { name: "Enregistrer le rattachement", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await call("auth/management-links")).find(
          (link) =>
            link.manager_id === parent.id && link.dependent_id === created.id,
        )?.capabilities,
    )
    .toEqual(full.filter((c) => c !== "export_profile").sort());
  await expect(links.getByRole("status")).toContainText(
    "Rattachement enregistré",
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await fs.mkdir(".local/scoped-accounts", { recursive: true });
  await page.screenshot({
    path: ".local/scoped-accounts/practitioner-mobile.png",
    fullPage: true,
  });

  const parentPage = await connect(parent);
  await expect(parentPage).toHaveURL(origin + "/accompagnement");
  await parentPage
    .getByRole("link", { name: "Comptes et rattachements", exact: true })
    .click();
  await expect(
    parentPage.getByRole("article", { name: createdName, exact: true }),
  ).toBeVisible();
  await expect(
    parentPage
      .getByRole("combobox", { name: "Type de compte", exact: true })
      .locator("option"),
  ).toHaveText(["Patient"]);
  await expect(
    parentPage.getByRole("article", {
      name: practitioner.display_name,
      exact: true,
    }),
  ).toHaveCount(0);
  await parentPage.screenshot({
    path: ".local/scoped-accounts/parent-mobile.png",
    fullPage: true,
  });

  const base = `profiles/${created.patient_profile_id}`;
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
  const patientPage = await connect(created);
  await expect(patientPage).toHaveURL(
    `${origin}/communication/${created.patient_profile_id}`,
  );
  await patientPage.getByRole("button", { name: "Eau", exact: true }).click();
  const confirm = patientPage.getByRole("button", {
    name: "C’est ça",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await confirm.click();
  await expect
    .poll(async () => (await call(base + "/memory")).interpretations.length)
    .toBe(1);
  await expect(
    patientPage.getByRole("link", {
      name: "Comptes et rattachements",
      exact: true,
    }),
  ).toHaveCount(0);
  await patientPage.goto(origin + "/accompagnement/comptes");
  await expect(
    patientPage.getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    }),
  ).toBeVisible();

  await links
    .getByLabel("Confirmer le retrait de ce rattachement", { exact: true })
    .check();
  await links
    .getByRole("button", { name: "Retirer le rattachement", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await call("auth/management-links")).some(
        (link) =>
          link.manager_id === parent.id && link.dependent_id === created.id,
      ),
    )
    .toBe(false);
  await parentPage.goto(
    `${origin}/accompagnement/personnes/${created.patient_profile_id}/clavier`,
  );
  await expect(
    parentPage.getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    ".local/scoped-accounts/report.json",
    JSON.stringify(
      {
        roleCreation: "passed",
        sharedParentIsolation: "passed",
        explicitPermissions: "passed",
        patientChoice: "passed",
        liveRevocation: "passed",
        memoryPreserved: "passed",
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Scoped roles: creation, shared-parent isolation, permissions, patient choice and live revocation passed.",
  );
} catch (failure) {
  await fs.mkdir(".local/scoped-accounts", { recursive: true });
  let index = 0;
  for (const context of contexts)
    for (const page of context.pages()) {
      await page
        .screenshot({
          path: `.local/scoped-accounts/failure-${index++}.png`,
          fullPage: true,
        })
        .catch(() => {});
    }
  throw failure;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await root.dispose();
}
