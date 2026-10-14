import assert from "node:assert/strict";
import test from "node:test";
import { bodyLimit, boundedBody } from "../src/lib/proxy-body.ts";

test("large backup files pass only the exact restore POST routes", async () => {
  const size = 9 * 1024 * 1024;
  const data = new Uint8Array(size);
  const request = () =>
    new Request("https://local.test", { method: "POST", body: data });
  assert.equal(
    (await boundedBody(request(), bodyLimit("POST", ["profiles", "restore"])))
      .length,
    size,
  );
  assert.equal(
    (
      await boundedBody(
        request(),
        bodyLimit("POST", ["profiles", "restore-preview"]),
      )
    ).length,
    size,
  );
  for (const [method, path] of [
    ["POST", ["profiles", "a", "restore"]],
    ["POST", ["profiles", "restore", "extra"]],
    ["PUT", ["profiles", "restore"]],
    ["POST", ["providers", "restore"]],
    ["POST", ["profiles", "a", "blocks", "photo"]],
  ]) {
    await assert.rejects(
      () => boundedBody(request(), bodyLimit(method, path)),
      RangeError,
    );
  }
});
