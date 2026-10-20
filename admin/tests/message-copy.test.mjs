import assert from "node:assert/strict";
import test from "node:test";
import { copyAttemptKey, parseCopyAttempt } from "../src/lib/message-copy.ts";

const sourceId = "a9bc0abf-6c55-4564-a679-ed957e64bcee";
const requestId = "6ca202f1-467b-4e3f-96a7-b65ac5ddb520";
test("copy recovery retains only separate valid identities under the cleared sequence prefix", () => {
  assert.deepEqual(
    parseCopyAttempt(
      JSON.stringify({
        sourceId,
        requestId,
        text: "private",
        block_ids: ["private"],
      }),
    ),
    { sourceId, requestId },
  );
  assert.notEqual(copyAttemptKey(sourceId), copyAttemptKey(requestId));
  assert(copyAttemptKey(sourceId).startsWith("pictoflow:sequence:"));
});
test("invalid recovery data never becomes a request or another source reference", () => {
  for (const value of [
    null,
    "{",
    "null",
    "[]",
    "{}",
    JSON.stringify({ sourceId, requestId: sourceId }),
    JSON.stringify({ sourceId, requestId: 123 }),
    JSON.stringify({ sourceId: "bad", requestId }),
  ])
    assert.equal(parseCopyAttempt(value), null);
});
