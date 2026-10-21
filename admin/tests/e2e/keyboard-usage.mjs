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
  const p = (await call("profiles", { display_name: "Usages fictifs" })).id;
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
  const interpretations = [];
  for (let i = 0; i < 2; i++) {
    const sequence = await call(base + "/sequences", {
      session_id: crypto.randomUUID(),
    });
    for (const action of ["append", "append", "complete"])
      await call(base + `/sequences/${sequence.id}/selection`, {
        action,
        ...(action === "append" ? { block_id: block.id } : {}),
      });
    const meaning = (
      await call(base + `/sequences/${sequence.id}/interpret`, {})
    ).candidates[0];
    await call(base + `/interpretations/${meaning.id}/feedback`, {
      action: "correct",
      actor_role: "caregiver",
      corrected_value: "Je veux boire encore.",
    });
    interpretations.push(meaning.id);
  }
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
  await page.goto(`${origin}/admin/profiles/${p}/keyboard`);
  const panel = page.getByRole("region", {
    name: "Touches souvent choisies",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Examiner mes usages acceptés", exact: true })
    .click();
  await panel
    .getByText("Choisie dans 2 messages acceptés de ce profil.", {
      exact: true,
    })
    .waitFor();
  await panel
    .getByText("Pourquoi cette touche apparaît", { exact: true })
    .click();
  await fs.mkdir(".local/keyboard-usage", { recursive: true });
  await panel.screenshot({ path: ".local/keyboard-usage/explained.png" });
  await panel
    .getByRole("link", { name: "Choisir la place de « Boire »", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    `touch-${block.id}`,
  );
  assert.deepEqual(await call(base + "/keyboard"), before);
  await call(base + `/interpretations/${interpretations[0]}/feedback`, {
    action: "reject",
    actor_role: "user",
  });
  await panel
    .getByRole("button", { name: "Examiner mes usages acceptés", exact: true })
    .click();
  await panel
    .getByText("Aucune touche à proposer pour le moment", { exact: false })
    .waitFor();
  assert.equal(await panel.getByRole("link").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Keyboard usage verified: distinct accepted messages, human corrections, explicit placement link, no movement and revocation.",
  );
} finally {
  await browser.close();
  await api.dispose();
}
