import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

test("offline worker falls back only for the generic navigation and immutable build assets, never API, auth, media or another screen", async () => {
  const listeners = {};
  const origin = "https://pictoflow.example";
  const active = "pictoflow-offline-shell-" + "a".repeat(64);
  const sandbox = {
    URL,
    Response,
    fetch: async () => {
      throw new Error("offline");
    },
    caches: {
      open: async (name) => ({
        match: async (path) =>
          name.endsWith("active")
            ? new Response(active)
            : path === "/offline"
              ? new Response("generic offline shell")
              : undefined,
      }),
    },
    self: {
      location: { origin },
      addEventListener: (name, handler) => (listeners[name] = handler),
    },
  };
  vm.runInNewContext(
    await fs.readFile(
      new URL("../public/offline-sw.js", import.meta.url),
      "utf8",
    ),
    sandbox,
  );
  for (const path of [
    "/api/pictoflow/auth/session",
    "/api/pictoflow/profiles/p/memory",
    "/api/pictoflow/profiles/p/representations/x/photo",
    "/communication/p",
    "/admin/profiles",
    "/offline?_rsc=1",
  ]) {
    let intercepted = false;
    listeners.fetch({
      request: { url: origin + path, method: "GET", mode: "navigate" },
      respondWith: () => (intercepted = true),
    });
    assert.equal(intercepted, false, path);
  }
  let response;
  listeners.fetch({
    request: { url: origin + "/offline", method: "GET", mode: "navigate" },
    respondWith: (value) => (response = value),
  });
  assert.equal(await (await response).text(), "generic offline shell");
  let intercepted = false;
  listeners.fetch({
    request: { url: origin + "/offline", method: "GET", mode: "cors" },
    respondWith: () => (intercepted = true),
  });
  assert.equal(intercepted, false);
});
