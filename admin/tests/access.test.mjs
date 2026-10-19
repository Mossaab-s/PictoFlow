import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPrepare,
  canProfile,
  profileCapabilities,
  isAdministrator,
  pathPermitted,
  assignedProfiles,
  entryRedirect,
  landingPath,
  profileToolPath,
} from "../src/lib/access.ts";
import { api, APIError, setCSRFToken } from "../src/lib/api.ts";
import {
  accessEpochKey,
  accompaniedKey,
  markAccompanied,
} from "../src/lib/access-transition.ts";

const p = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const session = {
  enabled: true,
  csrf_token: "test-csrf",
  account: {
    id: "account",
    username: "speaker",
    display_name: "Fictif",
    active: true,
    is_admin: false,
    profile_access: { [p]: "communicator" },
  },
};

test("accompanied sessions stay on one keyboard even through legacy and support URLs", () => {
  const assisted = {
    ...session,
    account: {
      ...session.account,
      assisted_profile_id: p,
      profile_capabilities: { [p]: ["communicate"] },
    },
  };
  assert.equal(landingPath(assisted), `/communication/${p}`);
  for (const path of [
    "/",
    "/admin",
    "/admin/access",
    `/admin/profiles/${p}/keyboard`,
    `/accompagnement/personnes/${p}`,
    `/communication/${other}`,
    "/offline",
  ])
    assert.equal(entryRedirect(assisted, path), `/communication/${p}`);
  assert(pathPermitted(assisted, `/communication/${p}`));
  assert(pathPermitted(assisted, `/communication/${p}/memoire`));
  assert(!canPrepare(assisted, p));
  assert(!canProfile(assisted, p, "review_meanings"));
});

test("a browser-wide scope change rejects late data even before this tab receives its event", async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  const values = new Map([[accessEpochKey, "adult"]]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    const pending = api("profiles");
    values.set(accessEpochKey, "accompanied");
    release(Response.json([{ id: other }]));
    await assert.rejects(pending, /Votre accès a changé/);
    const markerOnlyChange = api("profiles");
    markAccompanied(p);
    release(Response.json([{ id: other }]));
    await assert.rejects(markerOnlyChange, /Votre accès a changé/);
    assert.equal(values.get(accompaniedKey), p);
    globalThis.localStorage.setItem = () => {};
    assert.throws(
      () => markAccompanied("pending"),
      /ne permet pas de protéger/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

test("explicit capabilities override broad role labels and do not imply review or export", () => {
  const limited = {
    ...session,
    account: {
      ...session.account,
      profile_access: { [p]: "editor" },
      profile_capabilities: { [p]: ["communicate"] },
    },
  };
  assert(pathPermitted(limited, `/communication/${p}`));
  assert(!canProfile(limited, p, "review_meanings"));
  assert(!canPrepare(limited, p));
  assert(!pathPermitted(limited, `/admin/profiles/${p}/keyboard`));
  assert(!pathPermitted(limited, `/admin/profiles/${p}/backup`));
  assert(!pathPermitted(limited, `/admin/profiles/${p}/ai-quality`));
  const missing = {
    ...limited,
    account: { ...limited.account, profile_capabilities: {} },
  };
  assert.deepEqual(profileCapabilities(missing.account, p), []);
  assert(!pathPermitted(missing, `/communication/${p}`));
  const prepare = {
    ...limited,
    account: {
      ...limited.account,
      profile_capabilities: { [p]: ["prepare_keyboard"] },
    },
  };
  assert(canPrepare(prepare, p));
  assert(pathPermitted(prepare, `/accompagnement/personnes/${p}/clavier`));
  assert(!pathPermitted(prepare, `/communication/${p}`));
  assert(!pathPermitted(prepare, `/admin/profiles/${p}/concepts`));
  assert(!pathPermitted(prepare, `/admin/profiles/${p}/made-up`));
});

test("communication UI exposes only granted profiles; account management and preparation need their own permission", () => {
  assert(pathPermitted(session, `/communication/${p}`));
  assert(pathPermitted(session, `/communication/${p}/memoire`));
  assert(!pathPermitted(session, `/communication/${other}`));
  assert(!pathPermitted(session, `/admin/profiles/${p}/keyboard`));
  assert(!pathPermitted(session, "/admin/access"));
  assert(!canPrepare(session, p));
  assert(!isAdministrator(session));
  const editor = {
    ...session,
    account: { ...session.account, profile_access: { [p]: "editor" } },
  };
  assert(canPrepare(editor, p));
  assert(!canPrepare(editor, other));
  assert(pathPermitted(editor, `/accompagnement/personnes/${p}/clavier`));
  assert(!pathPermitted(editor, "/admin/restore-profile"));
  assert(
    pathPermitted(
      { ...session, account: { ...session.account, is_admin: true } },
      "/admin/access",
    ),
  );
  assert(!pathPermitted({ ...session, account: null }, `/communication/${p}`));
  assert(
    pathPermitted(
      { enabled: false, account: null, csrf_token: null },
      "/admin/providers",
    ),
  );
});

test("entry resolves actual per-profile grants, including mixed, multiple and empty accounts", () => {
  const withRights = (rights) => ({
    ...session,
    account: { ...session.account, profile_capabilities: rights },
  });
  assert.equal(landingPath(session), `/communication/${p}`);
  assert.equal(
    landingPath(withRights({ [p]: ["communicate"], [other]: ["communicate"] })),
    "/communication",
  );
  assert.equal(landingPath(withRights({})), "/communication");
  for (const capability of [
    "prepare_keyboard",
    "manage_meanings",
    "view_history",
    "export_profile",
    "review_meanings",
  ]) {
    assert.equal(
      landingPath(withRights({ [p]: [capability] })),
      "/accompagnement",
    );
  }
  const mixed = withRights({
    [p]: ["communicate", "review_meanings"],
    [other]: ["prepare_keyboard"],
  });
  assert.equal(landingPath(mixed), "/accompagnement");
  assert.deepEqual(assignedProfiles(mixed, "support"), [other]);
  assert.deepEqual(assignedProfiles(mixed, "communication"), [p]);
  assert(!pathPermitted(mixed, `/accompagnement/personnes/${p}`));
  assert(pathPermitted(mixed, `/accompagnement/personnes/${other}/clavier`));
  assert(!pathPermitted(mixed, `/communication/${other}`));
  assert(
    !pathPermitted(mixed, `/accompagnement/personnes/${other}/constructor`),
  );
  assert.equal(
    landingPath({
      ...session,
      account: { ...session.account, is_admin: true },
    }),
    "/admin",
  );
});

test("legacy routes only alias known authorized tools; denied routes never mount admin content", () => {
  const supporter = {
    ...session,
    account: {
      ...session.account,
      profile_capabilities: { [p]: ["prepare_keyboard"] },
    },
  };
  assert.equal(entryRedirect(session, "/"), `/communication/${p}`);
  assert.equal(
    entryRedirect(session, "/admin/profiles"),
    `/communication/${p}`,
  );
  assert.equal(
    entryRedirect(session, `/admin/profiles/${p}/memory`),
    `/communication/${p}/memoire`,
  );
  assert.equal(
    entryRedirect(supporter, `/admin/profiles/${p}/keyboard`),
    `/accompagnement/personnes/${p}/clavier`,
  );
  assert.equal(
    entryRedirect(supporter, `/admin/profiles/${other}/keyboard`),
    null,
  );
  assert.equal(entryRedirect(session, `/admin/profiles/${p}/keyboard`), null);
  assert.equal(entryRedirect(session, "/admin/access"), null);
  assert.equal(entryRedirect(session, "https://untrusted.invalid"), null);
  assert.equal(
    profileToolPath(supporter, p, "keyboard"),
    `/accompagnement/personnes/${p}/clavier`,
  );
  assert(!pathPermitted(supporter, `/admin/profiles/${p}/keyboard`));
  const exporter = {
    ...supporter,
    account: {
      ...supporter.account,
      profile_capabilities: { [p]: ["export_profile"] },
    },
  };
  assert(pathPermitted(exporter, `/accompagnement/personnes/${p}/sauvegarde`));
  assert(!pathPermitted(exporter, `/accompagnement/personnes/${p}/clavier`));
  assert(!pathPermitted(exporter, `/accompagnement/personnes/${p}/phrases`));
});

test("a response from an older login cannot populate the next account's screen", async () => {
  const original = globalThis.fetch;
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  try {
    setCSRFToken("session-A");
    const pending = api("profiles");
    setCSRFToken("session-B");
    release(Response.json([{ id: p }]));
    await assert.rejects(pending, /Votre accès a changé/);
  } finally {
    globalThis.fetch = original;
    setCSRFToken(null);
  }
});

test("mutations carry only the current CSRF token; denied/expired access causes a session refresh signal", async () => {
  const original = globalThis.fetch;
  const oldWindow = globalThis.window;
  const target = new EventTarget();
  const events = [];
  globalThis.window = target;
  target.addEventListener("pictoflow:session-expired", () =>
    events.push("expired"),
  );
  target.addEventListener("pictoflow:access-changed", () =>
    events.push("changed"),
  );
  try {
    setCSRFToken("current");
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers["X-CSRF-Token"], "current");
      assert.equal(options.cache, "no-store");
      return Response.json({}, { status: 403 });
    };
    await assert.rejects(
      api(`profiles/${p}`, { method: "PATCH", body: "{}" }),
      APIError,
    );
    assert.deepEqual(events, ["changed"]);
    globalThis.fetch = async () => Response.json({}, { status: 401 });
    await assert.rejects(api("profiles"), APIError);
    assert.deepEqual(events, ["changed", "expired"]);
  } finally {
    globalThis.fetch = original;
    globalThis.window = oldWindow;
    setCSRFToken(null);
  }
});
