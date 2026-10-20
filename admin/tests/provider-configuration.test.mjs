import test from "node:test";
import assert from "node:assert/strict";
import { sameProviderEndpoint } from "../src/lib/provider-configuration.ts";

test("keeping a key requires the same normalized provider endpoint", () => {
  const current = {
    provider: "openai-compatible",
    base_url: "https://API.test:443/v1/",
  };
  assert(
    sameProviderEndpoint(current, {
      provider: "openai-compatible",
      base_url: "https://api.test/v1",
    }),
  );
  assert(
    !sameProviderEndpoint(current, {
      provider: "openai-compatible",
      base_url: "https://foreign.test/v1",
    }),
  );
  assert(
    !sameProviderEndpoint(current, {
      provider: "prism",
      base_url: "https://api.test/v1",
    }),
  );
  assert(
    !sameProviderEndpoint(current, {
      provider: "openai-compatible",
      base_url: "https://api.test/other",
    }),
  );
});
