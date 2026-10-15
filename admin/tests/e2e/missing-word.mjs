import assert from "node:assert/strict";
import { chromium, request } from "@playwright/test";

const origin = "http://127.0.0.1:3130";
const api = await request.newContext({ baseURL: origin });
async function call(path, data) {
  const response =
    data === undefined
      ? await api.get("/api/pictoflow/" + path)
      : await api.post("/api/pictoflow/" + path, { data });
  assert(response.ok(), `${path}: ${response.status()}`);
  return response.json();
}
const browser = await chromium.launch({ headless: true });
try {
  const p = (await call("profiles", { display_name: "Mot manquant fictif" }))
    .id;
  const base = `profiles/${p}`;
  const block = await call(base + "/blocks/personal", {
    request_id: crypto.randomUUID(),
    label: "Boire",
    pictogram_key: "drink",
    actor_role: "user",
  });
  await call(base + `/blocks/${block.id}/feedback`, {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  let ai = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/interpret")) ai++;
  });
  await page.goto(`${origin}/communication/${p}`);
  await page
    .locator(".communication-keyboard")
    .getByRole("button", { name: "Boire", exact: true })
    .click();
  await page
    .locator(".message-panel")
    .getByText("Boire", { exact: true })
    .waitFor();
  const reference = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)),
    `pictoflow:sequence:${p}`,
  );
  const before = await call(base + `/sequences/${reference.sequence_id}`);
  assert(before);
  await page
    .getByRole("link", { name: "Il me manque un mot", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Ajouter le mot qui me manque", exact: true })
    .waitFor();
  await page
    .getByLabel("Texte affiché sur la touche", { exact: true })
    .fill("Eau");
  await page
    .getByLabel("Ce que cette touche signifie pour moi, facultatif", {
      exact: false,
    })
    .fill("Mon verre d’eau");
  await page
    .getByLabel("Rechercher un dessin", { exact: true })
    .first()
    .fill("Eau");
  await page.getByRole("radio", { name: "Eau", exact: true }).check();
  await page
    .getByRole("button", { name: "Créer la touche à vérifier", exact: true })
    .click();
  const proposed = page
    .locator(".block-list section.panel")
    .filter({ has: page.getByRole("heading", { name: "Eau", exact: true }) });
  await proposed.getByText("Mon verre d’eau", { exact: false }).waitFor();
  await proposed
    .getByRole("button", {
      name: "Valider le dessin et le mot",
      exact: true,
    })
    .click();
  await page
    .getByRole("link", { name: "Reprendre mon message", exact: true })
    .click();
  const restored = await call(base + `/sequences/${before.id}`);
  assert.deepEqual(restored.block_ids, [block.id]);
  assert.equal(restored.status, "in_progress");
  await page
    .locator(".message-panel")
    .getByText("Boire", { exact: true })
    .waitFor();
  await page
    .locator(".communication-keyboard")
    .getByRole("button", { name: "Eau", exact: true })
    .click();
  assert.equal(
    (await call(base + `/sequences/${before.id}`)).block_ids.length,
    2,
  );
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  assert.equal(ai, 0);
  console.log(
    "Missing word verified: prepare, review, return to the same message, select explicitly, no AI or automatic acceptance.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
