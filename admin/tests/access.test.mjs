import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPrepare,
  isAdministrator,
  pathPermitted,
} from "../src/lib/access.ts";
import { api, APIError, setCSRFToken } from "../src/lib/api.ts";

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

test("communication UI exposes only granted profiles; account management and preparation need their own permission", () => {
  assert(pathPermitted(session, `/communication/${p}`));
  assert(pathPermitted(session, `/admin/profiles/${p}/memory`));
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
  assert(pathPermitted(editor, `/admin/profiles/${p}/keyboard`));
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
