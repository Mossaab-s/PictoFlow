import assert from "node:assert/strict";
import test from "node:test";
import { matchingProfiles, profileTitle } from "../src/lib/profiles.ts";

test("legacy unnamed profiles have a stable title independent of list order", () => {
  const profile = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.equal(profileTitle(profile), "Profil sans nom · aaaaaaaa");
  assert.equal(
    profileTitle({ ...profile, display_name: null }),
    profileTitle(profile),
  );
  assert.equal(profileTitle({ ...profile, display_name: "Élodie" }), "Élodie");
});

test("search finds accents and identifiers without merging identical names", () => {
  const profiles = [
    { id: "first-id", display_name: "Élodie (démo)" },
    { id: "second-id", display_name: "Élodie (démo)" },
    { id: "third-id", display_name: null },
  ];
  assert.deepEqual(
    matchingProfiles(profiles, "  elodie  "),
    profiles.slice(0, 2),
  );
  assert.deepEqual(matchingProfiles(profiles, "SECOND-ID"), [profiles[1]]);
  assert.deepEqual(matchingProfiles(profiles, "Profil sans nom"), [
    profiles[2],
  ]);
  assert.deepEqual(matchingProfiles(profiles, "absent"), []);
  assert.deepEqual(matchingProfiles(profiles, ""), profiles);
  assert.equal(profiles[0].display_name, "Élodie (démo)");
});
