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
  const p = (
    await call("profiles", {
      display_name: "Pictogrammes du quotidien fictifs",
    })
  ).id;
  const base = `profiles/${p}`;
  const old = await call(base + "/blocks/personal", {
    request_id: crypto.randomUUID(),
    label: "Boire",
    pictogram_key: "drink",
    actor_role: "user",
  });
  await call(base + `/blocks/${old.id}/feedback`, {
    action: "confirm",
    actor_role: "user",
    confirm_representation: true,
  });
  // Pin an explicitly chosen place; automatic positions of unplaced touches are provisional.
  const placement = await api.put(`/api/pictoflow/${base}/keyboard/${old.id}`, {
    data: { zone: "personal", position: 0, actor_role: "user" },
  });
  assert(placement.ok());
  const before = await call(base + "/keyboard");
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  // This scenario exercises the detailed tools available from Options.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("pictoflow:communication-view", "tools");
    } catch {
      /* Optional UI preference. */
    }
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const writes = [];
  let ai = 0;
  const external = [];
  page.on("request", (r) => {
    if (r.method() === "POST") writes.push(r.url());
    if (r.url().endsWith("/interpret")) ai++;
    if (!r.url().startsWith(origin)) external.push(r.url());
  });
  await page.goto(`${origin}/admin/profiles/${p}/keyboard`);
  const picker = page.locator("fieldset.pictogram-picker").first();
  await picker.getByText("140 dessins trouvés", { exact: true }).waitFor();
  assert.equal(await picker.getByRole("radio").count(), 140);
  assert.equal(await picker.locator("svg").count(), 140);
  const invalid = await picker.locator("svg").evaluateAll(
    (nodes) =>
      nodes.filter((svg) => {
        const b = svg.getBBox();
        return (
          !b.width ||
          !b.height ||
          b.x < 0 ||
          b.y < 0 ||
          b.x + b.width > 120 ||
          b.y + b.height > 120
        );
      }).length,
  );
  assert.equal(invalid, 0);
  await picker
    .getByLabel("Rechercher un dessin", { exact: true })
    .fill("pomme");
  await picker.getByRole("radio", { name: "Pomme", exact: true }).check();
  await page
    .getByRole("button", { name: "Continuer : le mot", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Texte affiché sur la touche", { exact: true })
      .inputValue(),
    "Pomme",
  );
  await page
    .getByRole("button", { name: "Revenir à l’image", exact: true })
    .click();
  await picker.getByRole("combobox").selectOption("care");
  await picker
    .getByLabel("Rechercher un dessin", { exact: true })
    .fill("brossage dents");
  assert(
    await picker.getByRole("radio", { name: "Pomme", exact: true }).isChecked(),
  );
  assert.equal(writes.length, 0);
  assert.deepEqual(await call(base + "/keyboard"), before);
  await fs.mkdir(".local/daily-pictograms", { recursive: true });
  await picker.screenshot({
    path: ".local/daily-pictograms/selection-retained.png",
  });
  async function confirm(label) {
    const panel = page
      .locator(".block-list section.panel")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
    await panel
      .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
      .waitFor();
    const proposed = (await call(base + "/blocks")).find(
      (b) => b.label === label,
    );
    assert.equal(proposed.status, "proposed");
    assert(
      !(await call(base + "/keyboard")).some((x) => x.block_id === proposed.id),
    );
    await panel
      .getByRole("button", { name: "Valider le dessin et le mot", exact: true })
      .click();
    await page.locator(`#touch-${proposed.id}`).waitFor();
    return proposed;
  }
  await page
    .getByRole("button", { name: "Continuer : le mot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Voir la touche à vérifier", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Créer la touche à vérifier", exact: true })
    .click();
  const apple = await confirm("Pomme");
  await picker
    .getByLabel("Rechercher un dessin", { exact: true })
    .fill("laver les mains");
  await picker
    .getByRole("radio", { name: "Laver les mains", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Continuer : le mot", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Voir la touche à vérifier", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Créer la touche à vérifier", exact: true })
    .click();
  const hands = await confirm("Laver les mains");
  assert.deepEqual(
    (await call(base + "/keyboard")).filter((x) => x.block_id === old.id),
    before,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.screenshot({
    path: ".local/daily-pictograms/picker-mobile.png",
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.goto(`${origin}/communication/${p}`);
  const keyboard = page.locator(".communication-keyboard");
  for (const [index, label] of [
    "Boire",
    "Pomme",
    "Laver les mains",
  ].entries()) {
    await keyboard.getByRole("button", { name: label, exact: true }).click();
    await page.locator(".message-touch").nth(index).waitFor();
  }
  assert.equal(await page.locator(".message-touch svg").count(), 3);
  assert.equal(
    await page.locator(".message-touch .pictogram-missing").count(),
    0,
  );
  assert.equal(ai, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const visuals = await call(base + "/representations");
  assert(
    visuals.some(
      (v) =>
        v.id === apple.representation_id &&
        v.asset_reference.endsWith(":apple"),
    ),
  );
  assert(
    visuals.some(
      (v) =>
        v.id === hands.representation_id &&
        v.asset_reference.endsWith(":wash_hands"),
    ),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: ".local/daily-pictograms/communication-mobile.png",
    fullPage: true,
  });
  console.log(
    "140 local drawings render; search preserves choice; new touches require validation; existing positions remain; mobile communication uses the new drawings without AI or external images.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
