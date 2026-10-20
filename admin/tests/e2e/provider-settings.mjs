import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { chromium, request, expect } from "@playwright/test";

const origin = "http://127.0.0.1:3132";
const password = "Synthetic capability CI passphrase";
const secret = "synthetic-provider-secret";
const received = [];
let outcome = "proposal";
const fixture = http.createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  received.push({
    path: req.url,
    method: req.method,
    key: req.headers.authorization,
    payload: raw ? JSON.parse(raw) : null,
  });
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET")
    return res.end(JSON.stringify({ data: [{ id: "synthetic-model" }] }));
  if (outcome === "auth") {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: secret }));
  }
  const proposal = {
    status: "proposal",
    candidates: [
      {
        intent: "DRINK_WATER",
        text: "Je veux boire de l’eau.",
        confidence: 0.7,
      },
    ],
  };
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content:
              outcome === "invalid"
                ? "invalid " + secret
                : JSON.stringify(proposal),
          },
        },
      ],
    }),
  );
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/v1`;
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
  assert(response.ok(), method + " " + path + ": " + response.status());
  return response.json();
}
const configuration = "providers/configuration";
const initial = await call(configuration);
assert.equal(initial.provider, "disabled");
const profile = (
  await call("profiles", "POST", {
    display_name: "Vérification provider fictive",
  })
).id;
const unchanged = {};
for (const name of ["audit", "memory", "blocks", "keyboard"])
  unchanged[name] = await call(`profiles/${profile}/${name}`);
const report = { status: "running", synthetic: true, checkpoints: [] };
const mark = (name) => report.checkpoints.push(name);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await fs.mkdir(".local/provider-settings", { recursive: true });
const form = page.getByRole("region", {
  name: "Configuration du fournisseur IA",
  exact: true,
});
const button = (name) => form.getByRole("button", { name, exact: true });
const get = (name) => form.getByLabel(name, { exact: true });
try {
  await page.goto(origin + "/");
  await page
    .getByLabel("Identifiant", { exact: true })
    .fill("capability-ci-admin");
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.locator(".account-bar")).toBeVisible();
  await page.goto(origin + "/admin/providers");
  await expect(get("Fournisseur")).toHaveValue("disabled");
  await get("Fournisseur").selectOption("openai-compatible");
  await get("Adresse de base de l’API").fill(fixtureUrl);
  await get("Modèle").fill("synthetic-model");
  await get("Action sur la clé").selectOption("replace");
  await get("Nouvelle clé d’API").fill(secret);
  await get("Température (vide : choix du fournisseur)").fill("");
  await button("Tester sans enregistrer").click();
  await expect(
    form.getByRole("region", { name: "Résultat du test" }),
  ).toContainText("Je veux boire de l’eau.");
  assert.equal((await call(configuration)).version, initial.version);
  const completion = received.find((item) => item.method === "POST");
  assert.equal(completion.key, "Bearer " + secret);
  assert(!("temperature" in completion.payload));
  const sample = JSON.parse(completion.payload.messages[1].content).request;
  assert.deepEqual(
    sample.blocks.map((block) => block.label),
    ["Moi", "Boire", "Eau"],
  );
  assert.deepEqual(sample.memory_examples, []);
  for (const [name, before] of Object.entries(unchanged))
    assert.deepEqual(await call(`profiles/${profile}/${name}`), before);
  mark(
    "Unsaved draft performs a real HTTP metadata and structured generation probe with only synthetic touches; active config and PCL unchanged",
  );
  await button("Enregistrer et activer").click();
  await form.getByText(/Configuration enregistrée et active/).waitFor();
  const saved = await call(configuration);
  assert.equal(saved.model, "synthetic-model");
  assert.equal(saved.api_key_configured, true);
  assert(!JSON.stringify(saved).includes(secret));
  assert(!("api_key" in saved));
  await expect(get("Nouvelle clé d’API")).toHaveCount(0);
  await page.reload();
  await expect(get("Modèle")).toHaveValue("synthetic-model");
  mark(
    "Explicit activation persists across page reload and never reads back the saved key",
  );
  await get("Adresse de base de l’API").fill(fixtureUrl + "-different");
  await expect(button("Tester sans enregistrer")).toBeDisabled();
  await expect(button("Enregistrer et activer")).toBeDisabled();
  await get("Action sur la clé").selectOption("clear");
  await button("Tester sans enregistrer").click();
  await expect(
    form.getByRole("region", { name: "Résultat du test" }),
  ).toContainText("Une proposition structurée");
  assert.equal(
    received.filter((item) => item.method === "POST").at(-1).key,
    undefined,
  );
  await get("Action sur la clé").selectOption("replace");
  await get("Nouvelle clé d’API").fill("synthetic-replacement-key");
  outcome = "auth";
  await button("Tester sans enregistrer").click();
  await expect(
    form.getByRole("region", { name: "Résultat du test" }),
  ).toContainText("La génération a échoué");
  assert(!(await form.innerText()).includes(secret));
  assert.equal((await call(configuration)).version, saved.version);
  outcome = "invalid";
  await button("Tester sans enregistrer").click();
  await expect(
    form.getByRole("region", { name: "Résultat du test" }),
  ).toContainText("La réponse ne respecte pas le format");
  assert(!(await form.innerText()).includes(secret));
  mark(
    "Endpoint changes cannot silently forward old credentials; explicit no-key test and redacted auth/invalid-output diagnostics",
  );
  outcome = "proposal";
  const external = {
    ...saved,
    model: "changed-in-another-tab",
    expected_version: saved.version,
    key_action: "keep",
  };
  for (const key of ["version", "source", "api_key_configured"])
    delete external[key];
  await call(configuration, "PUT", external);
  await button("Enregistrer et activer").click();
  await expect(form.getByRole("alert")).toContainText("autre onglet");
  await expect(get("Modèle")).toBeDisabled();
  await button("Recharger la configuration").click();
  await expect(get("Modèle")).toHaveValue("changed-in-another-tab");
  await get("Modèle").fill("committed-response-lost");
  let saves = 0;
  const configURL = origin + "/api/pictoflow/" + configuration;
  await page.route(configURL, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saves++;
    const response = await route.fetch();
    assert(response.ok());
    await route.abort("failed");
  });
  await button("Enregistrer et activer").click();
  await expect(form.getByRole("alert")).toContainText(
    "n’a pas pu être confirmé",
  );
  assert.equal(saves, 1);
  await expect(button("Enregistrer et activer")).toBeDisabled();
  await page.unroute(configURL);
  await button("Recharger la configuration").click();
  await expect(get("Modèle")).toHaveValue("committed-response-lost");
  mark(
    "Concurrent changes require reload; a lost committed save response never triggers an automatic replay",
  );
  await page.setViewportSize({ width: 320, height: 900 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: ".local/provider-settings/settings-mobile.png",
    fullPage: true,
  });
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  assert(!storage.includes(secret));
  assert(!storage.includes("synthetic-replacement-key"));
  for (const [name, before] of Object.entries(unchanged))
    assert.deepEqual(await call(`profiles/${profile}/${name}`), before);
  assert.deepEqual(errors, []);
  mark(
    "Mobile settings have no horizontal overflow, secrets are absent from browser storage and PCL stays unchanged",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  throw error;
} finally {
  const current = await call(configuration);
  const restore = {
    ...initial,
    expected_version: current.version,
    key_action: "clear",
  };
  for (const key of ["version", "source", "api_key_configured"])
    delete restore[key];
  await call(configuration, "PUT", restore);
  await fs.writeFile(
    ".local/provider-settings/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await admin.dispose();
  await new Promise((resolve) => fixture.close(resolve));
}
