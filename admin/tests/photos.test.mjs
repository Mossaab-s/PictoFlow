import assert from "node:assert/strict";
import test from "node:test";
import { photoUrl, photoFileError, photoBase64 } from "../src/lib/photos.ts";
import { boundedBody } from "../src/lib/proxy-body.ts";

const visual = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  profile_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  type: "photo",
  source: "personal-photo",
  status: "validated",
  asset_reference: "photo:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
test("photo references produce only scoped local URLs", () => {
  assert.match(photoUrl(visual), /^\/api\/pictoflow\/profiles\/bbbbbbbb-/);
  assert.equal(
    photoUrl({
      ...visual,
      asset_reference: "https://external.test/private.jpg",
    }),
    undefined,
  );
  assert.equal(photoUrl({ ...visual, profile_id: "../foreign" }), undefined);
  assert.equal(photoUrl({ ...visual, status: "rejected" }), undefined);
  assert.equal(photoUrl({ ...visual, source: "external" }), undefined);
});
test("photo selection is bounded; binary bytes survive encoding", async () => {
  assert.ok(photoFileError({ type: "image/svg+xml", size: 5 }));
  assert.ok(photoFileError({ type: "image/png", size: 6 * 1024 * 1024 }));
  const file = new File([new Uint8Array([0, 128, 255])], "photo.png", {
    type: "image/png",
  });
  assert.equal(await photoBase64(file), "AID/");
});
test("proxy reads a body without Content-Length and rejects a stream exceeding its limit", async () => {
  const request = new Request("https://local.test", {
    method: "POST",
    body: "photo",
  });
  assert.equal(
    new TextDecoder().decode(await boundedBody(request, 5)),
    "photo",
  );
  const oversized = new Request("https://local.test", {
    method: "POST",
    body: "photos",
  });
  await assert.rejects(() => boundedBody(oversized, 5), RangeError);
});
