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
const profile = (
  await call("profiles", "POST", {
    display_name: "Clavier fictif à droits limités",
  })
).id;
const other = (
  await call("profiles", "POST", { display_name: "Profil non attribué" })
).id;
const base = `profiles/${profile}`;
const user = await call("auth/users", "POST", {
  username: "capability-ci-user",
  display_name: "Compte limité fictif",
  password,
});
const grantPath = `auth/users/${user.id}/profiles/${profile}/capabilities`;
await call(grantPath, "PUT", {
  capabilities: ["communicate"],
  expected_capabilities: null,
});
const block = await call(base + "/blocks/personal", "POST", {
  request_id: crypto.randomUUID(),
  label: "Eau",
  pictogram_key: "water",
  actor_role: "user",
});
await call(base + `/blocks/${block.id}/feedback`, "POST", {
  action: "confirm",
  confirm_representation: true,
  actor_role: "user",
});
await call(base + `/keyboard/${block.id}`, "PUT", {
  zone: "personal",
  position: 0,
  actor_role: "user",
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await fs.mkdir(".local/profile-capabilities", { recursive: true });
async function connect(username) {
  await page.getByLabel("Identifiant", { exact: true }).fill(username);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
}
try {
  await page.goto(origin + "/admin/access");
  await connect("capability-ci-admin");
  const card = page.getByRole("article", {
    name: "Compte limité fictif",
    exact: true,
  });
  await card.getByLabel("Profil", { exact: true }).selectOption(profile);
  await expect(
    card.getByLabel("Communiquer et lire les phrases", { exact: true }),
  ).toBeChecked();
  const review = card.getByLabel("Confirmer, corriger ou refuser les phrases", {
    exact: true,
  });
  await expect(review).not.toBeChecked();
  await review.check();
  await card
    .getByRole("button", { name: "Enregistrer l’accès", exact: true })
    .click();
  await card
    .getByText("Accès enregistré. Il s’applique dès la prochaine requête.", {
      exact: true,
    })
    .waitFor();
  const saved = (await call("auth/users")).find((item) => item.id === user.id);
  assert.deepEqual(saved.profile_capabilities[profile], [
    "communicate",
    "review_meanings",
  ]);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await card.screenshot({
    path: ".local/profile-capabilities/admin-grant-mobile.png",
  });
  await page
    .getByRole("button", {
      name: "Se déconnecter et effacer les copies locales",
      exact: true,
    })
    .click();
  await call(grantPath, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: ["communicate", "review_meanings"],
  });
  await connect("capability-ci-user");
  await page.goto(`${origin}/communication/${profile}`);
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
  await page.locator(".interpretation-card").waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "C'est ce que je veux dire", exact: true })
      .count(),
    0,
  );
  const candidate = (await call(base + "/interpretations"))[0];
  assert.equal(candidate.status, "proposed");
  const session = await (
    await page.request.get(origin + "/api/pictoflow/auth/session")
  ).json();
  const denied = await page.request.post(
    origin + `/api/pictoflow/${base}/interpretations/${candidate.id}/feedback`,
    {
      headers: { Origin: origin, "X-CSRF-Token": session.csrf_token },
      data: { action: "confirm", actor_role: "professional" },
    },
  );
  assert.equal(denied.status(), 403);
  assert.equal(
    (
      await page.request.get(
        origin + `/api/pictoflow/profiles/${other}/keyboard`,
      )
    ).status(),
    404,
  );
  await page.screenshot({
    path: ".local/profile-capabilities/communication-without-review.png",
    fullPage: true,
  });
  await call(grantPath, "PUT", {
    capabilities: ["communicate", "review_meanings"],
    expected_capabilities: ["communicate"],
  });
  await page.reload();
  const confirm = page.getByRole("button", {
    name: "C'est ce que je veux dire",
    exact: true,
  });
  await confirm.waitFor();
  assert.equal(
    (await call(base + `/interpretations/${candidate.id}`)).status,
    "proposed",
  );
  await confirm.click();
  await page
    .locator(".interpretation-card")
    .getByText("Mémoire validée", { exact: true })
    .waitFor();
  assert.equal(
    (await call(base + `/interpretations/${candidate.id}`)).status,
    "confirmed",
  );
  await call(grantPath, "PUT", {
    capabilities: ["communicate"],
    expected_capabilities: ["communicate", "review_meanings"],
  });
  await page
    .getByRole("button", {
      name: "Retirer cette interprétation de la mémoire validée",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", { name: "Je communique", exact: true })
    .waitFor();
  await expect(
    page.getByRole("button", {
      name: "Retirer cette interprétation de la mémoire validée",
      exact: true,
    }),
  ).toHaveCount(0);
  assert.equal(
    (await call(base + `/interpretations/${candidate.id}`)).status,
    "confirmed",
  );
  await page.goto(origin + "/admin/access");
  await page
    .getByRole("heading", {
      name: "Ce profil ou cet écran ne vous est pas accessible.",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Real authenticated capability management, independent composition/review, live revocation, human acceptance and cross-profile denial verified.",
  );
} catch (error) {
  await page.screenshot({
    path: ".local/profile-capabilities/failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await admin.dispose();
}
