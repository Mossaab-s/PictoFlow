import assert from "node:assert/strict";
import test from "node:test";
import {
  suggestionMode,
  suggestionKey,
  joinMemoryWords,
  wordKey,
} from "../src/lib/memory-suggestions.ts";

test("only explicit profile scoped suggestion preferences are stored, never phrase content", () => {
  for (const value of [null, "", "AI", '{"words":true}', "off"])
    assert.equal(suggestionMode(value), "off");
  assert.equal(suggestionMode("words"), "words");
  assert.equal(suggestionMode("phrases"), "phrases");
  assert.notEqual(suggestionKey("first"), suggestionKey("second"));
});

test("word composition preserves choices, repetitions and French elisions without adding vocabulary", () => {
  assert.equal(
    joinMemoryWords(
      ["Je", "veux", "boire", "boire", "de", "l’", "eau"].map((text) => ({
        text,
      })),
    ),
    "Je veux boire boire de l’eau",
  );
  assert.equal(joinMemoryWords([{ text: "J'" }, { text: "ai" }]), "J'ai");
  assert.equal(joinMemoryWords([]), "");
  assert.equal(wordKey("L’"), wordKey("l'"));
  assert.equal(wordKey("É"), wordKey("E\u0301"));
  assert.notEqual(wordKey("a"), wordKey("à"));
});
