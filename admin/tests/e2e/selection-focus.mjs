import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

// Exercise the production DOM helper in Chromium without a Next server or API.
const source = await fs.readFile(
  new URL("../../src/lib/selection-focus.ts", import.meta.url),
  "utf8",
);
const moduleText = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const cases = [];
const externalRequests = [];
page.on("request", (request) => {
  if (!request.url().startsWith("http://selection-focus.test/"))
    externalRequests.push(request.url());
});
async function reset() {
  await page.goto("http://selection-focus.test/");
  await page.evaluate(async () => {
    window.beginSelectionFocus = (
      await import("/selection-focus.js")
    ).beginSelectionFocus;
    document.querySelector("#result").focus();
  });
}
async function frames() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function start() {
  await page.evaluate(() => {
    const button = document.querySelector("#result");
    window.attempt = window.beginSelectionFocus(button);
    button.disabled = true;
    document.body.focus();
  });
}
const result = page.locator("#result");
try {
  await page.route("http://selection-focus.test/**", (route) =>
    route.fulfill(
      route.request().url().endsWith("/selection-focus.js")
        ? { contentType: "text/javascript", body: moduleText }
        : {
            contentType: "text/html",
            body: '<!doctype html><body tabindex="-1"><button id="result">Water</button><button id="other">Other result</button><input id="search" aria-label="Search"><div id="blank" style="height:80px">Background</div></body>',
          },
    ),
  );
  await reset();
  await start();
  await page.evaluate(() => window.attempt.settled());
  await frames();
  await expect(result).toBeDisabled();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  await page.evaluate(() => {
    document.querySelector("#result").disabled = false;
  });
  await expect(result).toBeFocused({ timeout: 1500 });
  cases.push(
    "settled selection waits past a disabled animation frame for enabled DOM",
  );

  await reset();
  await start();
  await page.evaluate(() => {
    document.querySelector("#result").disabled = false;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  await page.evaluate(() => window.attempt.settled());
  await expect(result).toBeFocused();
  cases.push("enabled DOM alone does not restore before selection settles");

  await reset();
  await start();
  await page.evaluate(() => window.attempt.settled());
  await frames();
  await page.locator("#search").focus();
  await page.evaluate(() => {
    document.body.focus();
    document.querySelector("#result").disabled = false;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  cases.push(
    "moving focus elsewhere permanently cancels even if focus returns to body",
  );

  await reset();
  await start();
  await page.evaluate(() => window.attempt.settled());
  await frames();
  await page.locator("#blank").click();
  await page.evaluate(() => {
    document.querySelector("#result").disabled = false;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  cases.push(
    "pointer interaction outside the result cancels without requiring another focusable target",
  );

  await reset();
  await start();
  await page.evaluate(() => window.attempt.settled());
  await frames();
  await page.keyboard.press("Tab");
  await page.evaluate(() => {
    document.body.focus();
    document.querySelector("#result").disabled = false;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  cases.push("explicit keyboard navigation cancels pending restoration");

  await reset();
  await start();
  await page.evaluate(() => {
    window.attempt.settled();
    window.attempt.cancel();
    const old = document.querySelector("#result");
    const replacement = old.cloneNode(true);
    replacement.disabled = false;
    old.replaceWith(replacement);
    old.disabled = false;
    window.attempt.settled();
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  cases.push(
    "cancelled scope and replaced results cannot revive an old attempt",
  );

  await reset();
  await start();
  await page.evaluate(() => window.attempt.settled());
  await frames();
  await page.evaluate(() => {
    // A different selection purpose can keep the same button mounted.
    window.attempt.cancel();
    document.querySelector("#result").disabled = false;
    window.attempt.settled();
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  cases.push("scope cancellation stays final even when the same node survives");

  await reset();
  await start();
  await page.evaluate(() => {
    window.attempt.settled();
    window.attempt.cancel();
    const next = document.querySelector("#other");
    next.focus();
    window.nextAttempt = window.beginSelectionFocus(next);
    next.disabled = true;
    document.body.focus();
    window.nextAttempt.settled();
    document.querySelector("#result").disabled = false;
  });
  await frames();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.body),
    true,
  );
  await page.evaluate(() => {
    document.querySelector("#other").disabled = false;
  });
  await expect(page.locator("#other")).toBeFocused();
  cases.push("a new selection supersedes the previous focus intent");

  assert.deepEqual(externalRequests, []);
  await fs.mkdir(".local/selection-focus", { recursive: true });
  await fs.writeFile(
    ".local/selection-focus/report.json",
    JSON.stringify(
      { status: "passed", cases, external_requests: externalRequests.length },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${cases.length} deterministic native-browser focus cases, without an API`,
  );
} finally {
  await browser.close();
}
