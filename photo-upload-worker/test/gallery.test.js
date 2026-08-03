import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../src/index.js";

test("gallery cursors round-trip without padding", () => {
  const cursor = { uploadedAt: "2026-08-03T12:34:56.000Z", id: "originals/2026-08-03/example.jpg" };
  const encoded = __test.base64UrlEncode(cursor);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(__test.base64UrlDecode(encoded), cursor);
  assert.equal(__test.base64UrlDecode("not-a-cursor"), null);
});

test("upload validation enforces separate image and video limits", () => {
  assert.equal(__test.validateUploadRequest({ contentType: "image/jpeg", sourceSize: 20 * 1024 * 1024 }).error, undefined);
  assert.equal(__test.validateUploadRequest({ contentType: "image/jpeg", sourceSize: 20 * 1024 * 1024 + 1 }).status, 413);
  assert.equal(__test.validateUploadRequest({ contentType: "video/mp4", sourceSize: 25 * 1024 * 1024 }).error, undefined);
  assert.equal(__test.validateUploadRequest({ contentType: "video/mp4", sourceSize: 25 * 1024 * 1024 + 1 }).status, 413);
  assert.equal(__test.validateUploadRequest({ contentType: "image/jpeg", sourceSize: 100, posterSize: 10 }).status, 413);
  assert.equal(__test.validateUploadRequest({ contentType: "application/pdf", sourceSize: 100 }).status, 415);
});

test("public image records expose only fixed variants and explicit original", () => {
  const request = new Request("https://media.streamvaults.co.uk/gallery");
  const item = __test.publicItem(request, {
    id: "originals/2026-08-03/photo.jpg",
    content_type: "image/jpeg",
    uploaded_at: "2026-08-03T12:00:00.000Z",
    poster_key: null
  });
  assert.deepEqual(Object.keys(item.variants), ["480", "800", "1200"]);
  assert.match(item.originalUrl, /^https:\/\/media\.streamvaults\.co\.uk\/media\//);
  assert.equal(item.posterUrl, null);
});

test("immutable media endpoints reject cache-busting queries", () => {
  assert.equal(__test.noUnexpectedQuery(new Request("https://media.streamvaults.co.uk/media/a")), true);
  assert.equal(__test.noUnexpectedQuery(new Request("https://media.streamvaults.co.uk/media/a?v=2")), false);
});

test("legacy content types are recovered from object keys", () => {
  assert.equal(__test.contentTypeForKey("originals/a.MOV"), "video/quicktime");
  assert.equal(__test.contentTypeForKey("originals/a.jpeg"), "image/jpeg");
});
