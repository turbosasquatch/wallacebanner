const MAX_BYTES = 25 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 5000;
const GALLERY_PAGE_SIZE = 100;
const UPLOADS_CLOSE_AT = Date.parse("2026-09-01T00:00:00+01:00");
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/webm"
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = new Set([
    "https://wallacebanner.co.uk",
    "http://127.0.0.1:4173",
    "http://localhost:4173"
  ]);
  const allowedOrigin = allowedOrigins.has(origin) ? origin : "https://wallacebanner.co.uk";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Event-Code, X-File-Name, X-Uploader-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function mediaUrl(request, key) {
  return `${new URL(request.url).origin}/media/${encodeURIComponent(key)}`;
}

function contentTypeForKey(key) {
  const extension = key.split(".").pop()?.toLowerCase();
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm"
  })[extension] || "application/octet-stream";
}

function galleryItem(request, object) {
  return {
    id: object.key,
    url: mediaUrl(request, object.key),
    contentType: object.httpMetadata?.contentType === "application/octet-stream"
      ? contentTypeForKey(object.key)
      : object.httpMetadata?.contentType || contentTypeForKey(object.key),
    uploadedAt: object.customMetadata?.uploadedAt || object.uploaded?.toISOString?.() || null,
    fingerprint: object.etag ? `${object.size}:${object.etag}` : object.key
  };
}

function compareGalleryItems(a, b) {
  return (b.uploadedAt || "").localeCompare(a.uploadedAt || "") || b.id.localeCompare(a.id);
}

function encodeGalleryCursor(item) {
  return btoa(JSON.stringify({ uploadedAt: item.uploadedAt, id: item.id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeGalleryCursor(value) {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof decoded.uploadedAt === "string" && typeof decoded.id === "string" ? decoded : null;
  } catch {
    return null;
  }
}

async function listAllGalleryObjects(env) {
  const objects = [];
  let cursor;
  do {
    const listed = await env.UPLOADS.list({
      prefix: "originals/",
      cursor,
      limit: 1000,
      include: ["httpMetadata", "customMetadata"]
    });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return objects;
}

async function handleGallery(request, env) {
  const url = new URL(request.url);
  const cursor = decodeGalleryCursor(url.searchParams.get("cursor"));
  const seen = new Set();
  const allItems = (await listAllGalleryObjects(env))
    .map((object) => galleryItem(request, object))
    .sort(compareGalleryItems)
    .filter((item) => {
      if (seen.has(item.fingerprint)) return false;
      seen.add(item.fingerprint);
      return true;
    });
  const start = cursor
    ? allItems.findIndex((item) => compareGalleryItems(item, cursor) > 0)
    : 0;
  const pageStart = start < 0 ? allItems.length : start;
  const items = allItems.slice(pageStart, pageStart + GALLERY_PAGE_SIZE);
  const hasMore = pageStart + items.length < allItems.length;
  const responseItems = items.map(({ fingerprint, ...item }) => item);
  return new Response(JSON.stringify({
    items: responseItems,
    nextCursor: hasMore && items.length ? encodeGalleryCursor(items.at(-1)) : null
  }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request)
    }
  });
}

async function handleMedia(request, env, encodedKey) {
  let key;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return json(request, { error: "Not found." }, 404);
  }
  if (!key.startsWith("originals/")) return json(request, { error: "Not found." }, 404);

  const rangeHeader = request.headers.get("Range");
  const match = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
  const range = match
    ? { offset: Number(match[1]), length: match[2] ? Number(match[2]) - Number(match[1]) + 1 : undefined }
    : undefined;
  if (range && (!Number.isSafeInteger(range.offset) || range.offset < 0 || (range.length !== undefined && (!Number.isSafeInteger(range.length) || range.length < 1)))) {
    return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", ...corsHeaders(request) } });
  }

  const object = await env.UPLOADS.get(key, range ? { range } : undefined);
  if (!object) return json(request, { error: "Not found." }, 404);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream"
  });
  if (range && object.range) {
    headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
  }
  for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  return new Response(object.body, { status: range && object.range ? 206 : 200, headers });
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) }
  });
}

function cleanFileName(value) {
  const decoded = decodeURIComponent(value || "upload");
  return decoded.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120) || "upload";
}

function cleanName(value) {
  return decodeURIComponent(value || "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
}

function extensionFor(fileName, contentType) {
  const match = fileName.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (match) return match[0].toLowerCase();
  return ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "image/heif": ".heif", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" })[contentType] || "";
}

export class RateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const entries = (await this.state.storage.get("entries")) || [];
    const active = entries.filter((entry) => entry > windowStart);
    if (active.length >= MAX_UPLOADS_PER_HOUR) {
      await this.state.storage.put("entries", active);
      return Response.json({ allowed: false });
    }
    active.push(now);
    await this.state.storage.put("entries", active);
    return Response.json({ allowed: true });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/gallery") return handleGallery(request, env);
    if (request.method === "GET" && path.startsWith("/media/")) return handleMedia(request, env, path.slice("/media/".length));
    if (request.method !== "POST" || path !== "/upload") return json(request, { error: "Not found." }, 404);
    if (Date.now() >= UPLOADS_CLOSE_AT) return json(request, { error: "The photo collection is now closed." }, 403);
    if (request.headers.get("X-Event-Code") !== env.EVENT_CODE) return json(request, { error: "That event code is not recognised." }, 401);

    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].toLowerCase();
    const contentLength = Number(request.headers.get("Content-Length"));
    if (!contentType || !ALLOWED_TYPES.has(contentType)) return json(request, { error: "Please choose a supported photo or video." }, 415);
    if (!request.body || !Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_BYTES) return json(request, { error: "Each file must be 25 MB or smaller." }, 413);

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(clientIp));
    const limit = await limiter.fetch("https://rate-limit/check");
    if (!(await limit.json()).allowed) return json(request, { error: "Please wait a little before uploading more files." }, 429);

    const sourceName = cleanFileName(request.headers.get("X-File-Name"));
    const uploader = cleanName(request.headers.get("X-Uploader-Name"));
    const date = new Date().toISOString().slice(0, 10);
    const key = `originals/${date}/${crypto.randomUUID()}${extensionFor(sourceName, contentType)}`;
    const fixedBody = new FixedLengthStream(contentLength);

    try {
      const write = env.UPLOADS.put(key, fixedBody.readable, {
        httpMetadata: { contentType, contentDisposition: `attachment; filename="${sourceName}"` },
        customMetadata: { originalName: sourceName, uploader, uploadedAt: new Date().toISOString() }
      });
      await request.body.pipeTo(fixedBody.writable);
      await write;
    } catch (error) {
      console.error("Upload failed", error);
      return json(request, { error: "The upload could not be saved. Please try again." }, 503);
    }
    return json(request, { uploadId: key, fileName: sourceName, uploadedAt: new Date().toISOString() }, 201);
  }
};
