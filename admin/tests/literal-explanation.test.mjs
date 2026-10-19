import assert from "node:assert/strict";
import test from "node:test";
import { literalExplanation } from "../src/lib/literal-explanation.ts";

test("literal explanations distinguish recorded causes without echoing provider data", () => {
  const reasons = [
    "disabled",
    "model_refusal",
    "unfaithful_words",
    "low_confidence",
    "unavailable",
    "invalid_payload",
  ];
  assert.equal(new Set(reasons.map(literalExplanation)).size, reasons.length);
  assert.match(literalExplanation("disabled"), /désactivée/);
  assert.match(literalExplanation("unavailable"), /indisponible/);
  assert.match(
    literalExplanation("invalid_payload"),
    /réponse.*pas pu être utilisée/,
  );
  assert.match(
    literalExplanation("unfaithful_words"),
    /vérification de vos mots/,
  );
  for (const unknown of [
    null,
    undefined,
    "private raw failure",
    {},
    [],
    "__proto__",
    "constructor",
  ])
    assert.equal(literalExplanation(unknown), literalExplanation(null));
  assert.match(literalExplanation(null), /pas été enregistrée/);
});
