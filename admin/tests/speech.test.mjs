import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseVoice,
  createLocalReader,
  defaultSpeech,
  localFrenchVoices,
  parseSpeech,
  serializeSpeech,
  speechStorageKey,
} from "../src/lib/speech.ts";

const remote = {
  voiceURI: "remote-fr",
  name: "Remote",
  lang: "fr-FR",
  localService: false,
  default: true,
};
const french = {
  voiceURI: "local-fr",
  name: "Local",
  lang: "fr-FR",
  localService: true,
  default: false,
};
const canadian = {
  voiceURI: "local-ca",
  name: "Canada",
  lang: "fr-CA",
  localService: true,
  default: true,
};
const english = {
  voiceURI: "local-en",
  name: "English",
  lang: "en-US",
  localService: true,
  default: true,
};

function rig() {
  let voices = [remote, french, canadian, english];
  const spoken = [];
  const states = [];
  let cancellations = 0;
  const synthesis = {
    getVoices: () => voices,
    speak: (message) => spoken.push(message),
    cancel: () => cancellations++,
  };
  const reader = createLocalReader(
    synthesis,
    (text) => ({ text }),
    (speaking, error) => states.push({ speaking, error }),
  );
  return {
    synthesis,
    reader,
    spoken,
    states,
    setVoices: (next) => {
      voices = next;
    },
    cancellations: () => cancellations,
  };
}

test("only local French voices can be selected, including when the saved voice disappears", () => {
  const list = [
    remote,
    french,
    canadian,
    english,
    french,
    { ...french, voiceURI: "wrong", lang: "french" },
  ];
  assert.deepEqual(localFrenchVoices(list), [french, canadian]);
  assert.equal(chooseVoice(list, french.voiceURI), french);
  assert.equal(chooseVoice(list, remote.voiceURI), canadian);
  assert.equal(chooseVoice(list, "missing"), canadian);
  assert.equal(chooseVoice([remote, english], ""), null);
  assert.equal(chooseVoice([french], ""), french);
});

test("voice/rate persistence is profile scoped, validated and contains no message", () => {
  assert.notEqual(speechStorageKey("a"), speechStorageKey("b"));
  for (const rate of ["slow", "normal", "fast"]) {
    const settings = { voiceURI: french.voiceURI, rate };
    assert.deepEqual(parseSpeech(serializeSpeech(settings)), settings);
    assert.deepEqual(Object.keys(JSON.parse(serializeSpeech(settings))), [
      "version",
      "voiceURI",
      "rate",
    ]);
  }
  for (const bad of [
    null,
    "{broken",
    "null",
    '{"version":2,"voiceURI":"local-fr","rate":"slow"}',
    '{"version":1,"voiceURI":42,"rate":"normal"}',
    '{"version":1,"voiceURI":"","rate":"constructor"}',
    JSON.stringify({ version: 1, voiceURI: "a".repeat(1001), rate: "normal" }),
  ])
    assert.deepEqual(parseSpeech(bad), defaultSpeech);
});

test("chosen text, repetitions and rate are read only on request, with stop available before onstart", () => {
  const r = rig();
  assert.equal(r.spoken.length, 0);
  r.reader.read("Maman boire Maman", {
    voiceURI: french.voiceURI,
    rate: "slow",
  });
  assert.equal(r.spoken[0].text, "Maman boire Maman");
  assert.equal(r.spoken[0].voice, french);
  assert.equal(r.spoken[0].rate, 0.7);
  assert.deepEqual(r.states.at(-1), { speaking: true, error: "" });
  r.reader.stop();
  r.spoken[0].onstart();
  r.spoken[0].onerror({ error: "synthesis-failed" });
  assert.deepEqual(r.states.at(-1), { speaking: false, error: "" });
  assert.equal(r.cancellations(), 2);
});

test("late callbacks from a replaced utterance cannot stop or fail the new reading", () => {
  const r = rig();
  r.reader.read("Premier", defaultSpeech);
  r.reader.read("Deuxième", { voiceURI: french.voiceURI, rate: "fast" });
  r.spoken[1].onstart();
  r.spoken[0].onend();
  r.spoken[0].onerror({ error: "audio-busy" });
  assert.equal(r.states.at(-1).speaking, true);
  r.spoken[1].onend();
  r.spoken[1].onerror({ error: "synthesis-failed" });
  assert.deepEqual(r.states.at(-1), { speaking: false, error: "" });
  r.reader.stop();
});

test("disappearing voices, unavailable engines and canceled speech do not fall back to a remote voice", () => {
  const r = rig();
  r.setVoices([remote, english]);
  r.reader.read("Bonjour", defaultSpeech);
  assert.equal(r.spoken.length, 0);
  assert.match(r.states.at(-1).error, /locale/);
  r.setVoices([french]);
  r.reader.read("Bonjour", defaultSpeech);
  r.spoken[0].onerror({ error: "interrupted" });
  assert.deepEqual(r.states.at(-1), { speaking: false, error: "" });
  r.synthesis.speak = () => {
    throw new Error("engine unavailable");
  };
  r.reader.read("Bonjour", defaultSpeech);
  assert.equal(r.states.at(-1).speaking, false);
  assert.match(r.states.at(-1).error, /lecture/);
  r.reader.read("  ", defaultSpeech);
  assert.deepEqual(r.states.at(-1), { speaking: false, error: "" });
});

test("an engine that never starts times out and cancels without replaying the text", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const r = rig();
  r.reader.read("Bonjour", defaultSpeech);
  context.mock.timers.tick(10000);
  assert.equal(r.states.at(-1).speaking, false);
  assert.match(r.states.at(-1).error, /ne répond pas/);
  assert.equal(r.spoken.length, 1);
  r.spoken[0].onstart();
  assert.equal(r.states.at(-1).speaking, false);
  r.reader.stop();
});
