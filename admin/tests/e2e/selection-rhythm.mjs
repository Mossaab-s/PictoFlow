import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
  const profile = (await call("profiles", { display_name: "Rythme fictif" }))
    .id;
  const base = `profiles/${profile}`;
  for (const [label, pictogram_key] of [
    ["Boire", "drink"],
    ["Eau", "water"],
  ]) {
    const block = await call(base + "/blocks/personal", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key,
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, {
      action: "confirm",
      actor_role: "user",
      confirm_representation: true,
    });
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let aiCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/interpret")) aiCalls++;
  });
  await page.goto(`${origin}/communication/${profile}`);
  const setting = page.getByRole("checkbox", {
    name: "Enregistrer les intervalles entre mes prochaines touches",
  });
  assert.equal(await setting.isChecked(), false);
  await setting.check();
  const keyboard = page.locator(".communication-keyboard");
  await keyboard.getByRole("button", { name: "Boire", exact: true }).click();
  await page.locator(".message-touch").first().waitFor();
  const water = keyboard.getByRole("button", { name: "Eau", exact: true });
  await water.focus();
  await water.press("Enter");
  await page.locator(".message-touch").nth(1).waitFor();
  const sequenceId = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)).sequence_id,
    `pictoflow:sequence:${profile}`,
  );
  const report = await call(base + `/sequences/${sequenceId}/rhythm`);
  assert.equal(report.intervals.length, 1);
  assert.equal(report.intervals[0].input_method, "keyboard");
  assert(report.intervals[0].interval_ms >= report.intervals[0].blocked_ms);
  await setting.uncheck();
  await water.click();
  await page.locator(".message-touch").nth(2).waitFor();
  assert.equal(
    (await call(base + `/sequences/${sequenceId}/rhythm`)).intervals.length,
    1,
  );
  await page
    .getByText("Voir le rythme observé de ce message", { exact: true })
    .click();
  await page
    .getByText("1 intervalle(s) observé(s).", { exact: false })
    .waitFor();
  assert.equal(aiCalls, 0);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await mkdir(".local/selection-rhythm", { recursive: true });
  await page.screenshot({
    path: ".local/selection-rhythm/observed-mobile.png",
    fullPage: true,
  });
  await page.reload();
  assert.equal(await setting.isChecked(), false);
  await page
    .getByText("Voir le rythme observé de ce message", { exact: true })
    .click();
  await page
    .getByText("1 intervalle(s) observé(s).", { exact: false })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Optional pointer/keyboard observations persist per message; disabled on reload, no AI call or learned meaning.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
