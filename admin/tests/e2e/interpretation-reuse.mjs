import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, expect, request } from "@playwright/test";

const origin = "http://127.0.0.1:3131";
const api = await request.newContext({ baseURL: origin });
async function call(path, method = "get", data) {
  const response = await api[method]("/api/pictoflow/" + path, {
    ...(data === undefined ? {} : { data }),
  });
  assert(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}
async function calls() {
  const response = await api.get("http://127.0.0.1:8001/_synthetic/calls");
  assert(response.ok());
  return (await response.json()).calls;
}
const browser = await chromium.launch({ headless: true });
try {
  const p = (
    await call("profiles", "post", { display_name: "Cache et mémoire fictifs" })
  ).id;
  const base = `profiles/${p}`;
  for (const [label, key] of [
    ["Boire", "drink"],
    ["Eau", "water"],
  ]) {
    const block = await call(base + "/blocks/personal", "post", {
      request_id: crypto.randomUUID(),
      label,
      pictogram_key: key,
      actor_role: "user",
    });
    await call(base + `/blocks/${block.id}/feedback`, "post", {
      action: "confirm",
      actor_role: "user",
      confirm_representation: true,
    });
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/interpret"))
      requests.push(r.postDataJSON());
  });
  await page.goto(`${origin}/communication/${p}`);
  async function compose() {
    const keyboard = page.locator(".communication-keyboard");
    for (const [index, label] of ["Boire", "Eau"].entries()) {
      await keyboard.getByRole("button", { name: label, exact: true }).click();
      await page.locator(".message-touch").nth(index).waitFor();
    }
    await page
      .getByRole("button", { name: "Terminer mon message", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Mon message terminé", exact: true })
      .waitFor();
    return page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)).sequence_id,
      `pictoflow:sequence:${p}`,
    );
  }
  async function next() {
    await page
      .getByRole("button", { name: "Nouveau message", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Oui, commencer un autre message",
        exact: true,
      })
      .click();
    await page
      .getByText("Votre message apparaîtra ici.", { exact: true })
      .waitFor();
  }
  async function configure(sequence) {
    const response = await api.post(
      "http://127.0.0.1:8001/_synthetic/fixture",
      {
        data: { profile_id: p, sequence_id: sequence },
      },
    );
    assert(response.ok());
  }
  const first = await compose();
  await configure(first);
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await expect(page.locator(".proposed-phrase")).toHaveText(
    "Je veux boire de l’eau.",
  );
  assert.equal(await calls(), 1);
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  await next();
  await compose();
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await expect(page.locator(".proposed-phrase")).toHaveText(
    "Je veux boire de l’eau.",
  );
  assert.equal(
    await calls(),
    1,
    "a pending cache hit must not call the provider",
  );
  await page
    .getByText("Sur quoi cette proposition s’appuie-t-elle ?", { exact: true })
    .click();
  await expect(
    page.getByText(
      "Cette proposition en attente est réutilisée depuis le cache",
      { exact: false },
    ),
  ).toBeVisible();
  assert.equal((await call(base + "/memory")).interpretations.length, 0);
  const card = page.locator(".interpretation-card");
  await card.getByText("Modifier la phrase", { exact: true }).click();
  await card.locator("textarea").fill("J’aime boire de l’eau.");
  await card
    .getByRole("button", { name: "Valider ma correction", exact: true })
    .click();
  await expect(
    card.getByText("Mémoire validée", { exact: true }),
  ).toBeVisible();
  await next();
  const third = await compose();
  await page
    .getByRole("button", { name: "Proposer une phrase", exact: true })
    .click();
  await expect(page.locator(".proposed-phrase")).toHaveText(
    "J’aime boire de l’eau.",
  );
  await expect(
    page.getByText(
      "Proposition issue uniquement des phrases acceptées de ce profil.",
      { exact: false },
    ),
  ).toBeVisible();
  assert.equal(
    await calls(),
    1,
    "accepted alignment must precede the pending cache",
  );
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  await fs.mkdir(".local/interpretation-reuse", { recursive: true });
  await page.screenshot({
    path: ".local/interpretation-reuse/memory-first-mobile.png",
    fullPage: true,
  });
  await configure(third);
  await page
    .getByRole("button", { name: "Proposer d’autres phrases", exact: true })
    .click();
  await expect(page.locator(".proposed-phrase")).toHaveText(
    "Je veux boire de l’eau.",
  );
  assert.equal(await calls(), 1, "explicit refresh must call the provider");
  assert.equal(requests.at(-1).refresh, true);
  assert.equal((await call(base + "/memory")).interpretations.length, 1);
  await page.reload();
  await expect(page.locator(".proposed-phrase")).toHaveText(
    "Je veux boire de l’eau.",
  );
  assert.equal(
    await calls(),
    1,
    "reopening a proposal must not regenerate or learn it",
  );
  assert.deepEqual(errors, []);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await fs.writeFile(
    ".local/interpretation-reuse/report.json",
    JSON.stringify(
      {
        status: "passed",
        pending_cache_without_provider: true,
        memory_first_without_provider: true,
        explicit_refresh: true,
        no_implicit_acceptance: true,
        no_overflow: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS real Redis pending reuse, accepted PCL priority and explicit AI refresh in the mobile UI",
  );
} finally {
  await browser.close();
  await api.dispose();
}
