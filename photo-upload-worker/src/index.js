const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_POSTER_BYTES = 1024 * 1024;
const MAX_R2_BYTES = 8_000_000_000;
const MAX_IMAGES = 1500;
const MAX_DAILY_SOURCES = 100;
const MAX_DAILY_PUTS = 200;
const MAX_UPLOADS_PER_IP_HOUR = 20;
const PAGE_SIZE = 18;
const QUERY_SIZE = PAGE_SIZE + 1;
const SESSION_TTL_MS = 60 * 60 * 1000;
const UPLOADS_CLOSE_AT = Date.parse("2026-09-01T00:00:00+01:00");
const IMAGE_WIDTHS = new Set([480, 800, 1200]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const POSTER_TYPE = "image/jpeg";

function allowedOrigin(origin) {
  return new Set([
    "https://wallacebanner.co.uk",
    "http://127.0.0.1:4173",
    "http://localhost:4173"
  ]).has(origin);
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin) ? origin : "https://wallacebanner.co.uk",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, X-Admin-Token, X-Event-Code",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...extraHeaders
    }
  });
}

function mediaHeaders(request, contentType, etag) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
    "Content-Type": contentType,
  });
  if (etag) headers.set("ETag", etag);
  return headers;
}

function contentTypeForKey(key) {
  const extension = key.split(".").pop()?.toLowerCase();
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    heic: "image/heic", heif: "image/heif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm"
  })[extension] || "application/octet-stream";
}

function cleanFileName(value) {
  return String(value || "upload")
    .replace(/[\r\n]/g, " ")
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .slice(0, 120) || "upload";
}

function cleanName(value) {
  return String(value || "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
}

function extensionFor(fileName, contentType) {
  const match = fileName.match(/\.([a-zA-Z0-9]{1,8})$/);
  if (match) return match[0].toLowerCase();
  return ({
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "image/heic": ".heic", "image/heif": ".heif", "video/mp4": ".mp4",
    "video/quicktime": ".mov", "video/webm": ".webm"
  })[contentType] || "";
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed.uploadedAt === "string" && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function encodedId(id) {
  return encodeURIComponent(id);
}

function publicItem(request, row) {
  const origin = new URL(request.url).origin;
  const id = encodedId(row.id);
  const isVideo = row.content_type.startsWith("video/");
  return {
    id: row.id,
    contentType: row.content_type,
    uploadedAt: row.uploaded_at,
    originalUrl: `${origin}/media/${id}`,
    posterUrl: row.poster_key ? `${origin}/media/${encodedId(row.poster_key)}` : null,
    variants: isVideo ? null : {
      480: `${origin}/image/480/${id}`,
      800: `${origin}/image/800/${id}`,
      1200: `${origin}/image/1200/${id}`
    }
  };
}

async function handleGallery(request, env) {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => key !== "cursor")) {
    return json(request, { error: "Unsupported gallery query." }, 400);
  }
  const cursorValue = url.searchParams.get("cursor");
  const cursor = base64UrlDecode(cursorValue);
  if (cursorValue && !cursor) return json(request, { error: "Invalid gallery cursor." }, 400);

  const statement = cursor
    ? env.DB.prepare(`SELECT id, content_type, uploaded_at, poster_key
        FROM media
        WHERE published = 1 AND (uploaded_at < ? OR (uploaded_at = ? AND id < ?))
        ORDER BY uploaded_at DESC, id DESC LIMIT ?`).bind(cursor.uploadedAt, cursor.uploadedAt, cursor.id, QUERY_SIZE)
    : env.DB.prepare(`SELECT id, content_type, uploaded_at, poster_key
        FROM media WHERE published = 1
        ORDER BY uploaded_at DESC, id DESC LIMIT ?`).bind(QUERY_SIZE);
  const [rowsResult, state] = await Promise.all([
    statement.all(),
    env.DB.prepare("SELECT total_count FROM gallery_state WHERE id = 1").first()
  ]);
  const rows = rowsResult.results || [];
  const pageRows = rows.slice(0, PAGE_SIZE);
  const last = pageRows.at(-1);
  return json(request, {
    items: pageRows.map((row) => publicItem(request, row)),
    nextCursor: rows.length > PAGE_SIZE && last ? base64UrlEncode({ uploadedAt: last.uploaded_at, id: last.id }) : null,
    totalCount: Number(state?.total_count || 0),
    pageSize: PAGE_SIZE
  });
}

function noUnexpectedQuery(request) {
  return new URL(request.url).search === "";
}

async function cachedResponse(request, context, producer) {
  if (!noUnexpectedQuery(request)) return json(request, { error: "Unsupported media query." }, 400);
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await producer();
  if (response.ok && response.status === 200) context.waitUntil(cache.put(request, response.clone()));
  return response;
}

function parseRange(value) {
  const match = value?.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return value ? false : null;
  const offset = Number(match[1]);
  const length = match[2] ? Number(match[2]) - offset + 1 : undefined;
  if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined && (!Number.isSafeInteger(length) || length < 1))) return false;
  return { offset, length };
}

async function handleMedia(request, env, context, encodedKey) {
  if (!noUnexpectedQuery(request)) return json(request, { error: "Unsupported media query." }, 400);
  let key;
  try { key = decodeURIComponent(encodedKey); } catch { return json(request, { error: "Not found." }, 404); }
  if (!key.startsWith("originals/") && !key.startsWith("posters/")) return json(request, { error: "Not found." }, 404);
  const range = parseRange(request.headers.get("Range"));
  if (range === false) return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes", ...corsHeaders(request) } });

  const produce = async () => {
    const object = await env.UPLOADS.get(key, range ? { range } : undefined);
    if (!object) return json(request, { error: "Not found." }, 404);
    const headers = mediaHeaders(request, object.httpMetadata?.contentType || contentTypeForKey(key), object.httpEtag);
    if (range && object.range) {
      headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    }
    return new Response(object.body, { status: range && object.range ? 206 : 200, headers });
  };
  return range ? produce() : cachedResponse(request, context, produce);
}

async function handleImage(request, env, context, widthValue, encodedKey) {
  const width = Number(widthValue);
  if (!IMAGE_WIDTHS.has(width)) return json(request, { error: "Unsupported image size." }, 404);
  let key;
  try { key = decodeURIComponent(encodedKey); } catch { return json(request, { error: "Not found." }, 404); }
  if (!key.startsWith("originals/")) return json(request, { error: "Not found." }, 404);

  return cachedResponse(request, context, async () => {
    const object = await env.UPLOADS.get(key);
    if (!object) return json(request, { error: "Not found." }, 404);
    const contentType = object.httpMetadata?.contentType || contentTypeForKey(key);
    if (!IMAGE_TYPES.has(contentType) || object.size > MAX_IMAGE_BYTES) {
      return json(request, { error: "This preview is unavailable." }, 415);
    }
    try {
      const transformed = (await env.IMAGES.input(object.body)
        .transform({ width })
        .output({ format: "image/webp", quality: 75, anim: false })).response();
      const headers = new Headers(transformed.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Content-Type", "image/webp");
      return new Response(transformed.body, { status: transformed.status, headers });
    } catch (error) {
      console.error("Image transformation failed", { key, width, message: error?.message });
      return json(request, { error: "This preview is temporarily unavailable." }, 503);
    }
  });
}

export class RateLimiter {
  constructor(state) { this.state = state; }
  async fetch() {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const entries = ((await this.state.storage.get("entries")) || []).filter((entry) => entry > windowStart);
    if (entries.length >= MAX_UPLOADS_PER_IP_HOUR) {
      await this.state.storage.put("entries", entries);
      return Response.json({ allowed: false });
    }
    entries.push(now);
    await this.state.storage.put("entries", entries);
    return Response.json({ allowed: true });
  }
}

async function checkUploadRate(request, env) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const limiter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(clientIp));
  const response = await limiter.fetch("https://rate-limit.internal/check");
  return (await response.json()).allowed;
}

function validateUploadRequest(body) {
  const contentType = String(body.contentType || "").split(";", 1)[0].toLowerCase();
  const sourceSize = Number(body.sourceSize);
  const posterSize = Number(body.posterSize || 0);
  const isImage = IMAGE_TYPES.has(contentType);
  const isVideo = VIDEO_TYPES.has(contentType);
  if (!isImage && !isVideo) return { error: "Please choose a supported photo or video.", status: 415 };
  const maximum = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (!Number.isSafeInteger(sourceSize) || sourceSize <= 0 || sourceSize > maximum) {
    return { error: `Photos must be 20 MB or smaller and videos must be 25 MB or smaller.`, status: 413 };
  }
  if (!Number.isSafeInteger(posterSize) || posterSize < 0 || posterSize > MAX_POSTER_BYTES || (isImage && posterSize !== 0)) {
    return { error: "The video preview is invalid.", status: 413 };
  }
  return {
    contentType,
    sourceSize,
    posterSize,
    isImage,
    fileName: cleanFileName(body.fileName),
    uploader: cleanName(body.uploader)
  };
}

async function reserveUpload(request, env) {
  if (Date.now() >= UPLOADS_CLOSE_AT) return json(request, { error: "The photo collection is now closed." }, 403);
  if (request.headers.get("X-Event-Code") !== env.EVENT_CODE) return json(request, { error: "That event code is not recognised." }, 401);
  if (!(await checkUploadRate(request, env))) return json(request, { error: "Please wait before uploading more files." }, 429);

  let body;
  try { body = await request.json(); } catch { return json(request, { error: "Invalid upload details." }, 400); }
  const upload = validateUploadRequest(body);
  if (upload.error) return json(request, { error: upload.error }, upload.status);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  await env.DB.prepare(`UPDATE gallery_state SET day = ?, daily_sources = 0, daily_puts = 0 WHERE id = 1 AND day <> ?`).bind(day, day).run();

  const requiredBytes = upload.sourceSize + upload.posterSize;
  const requiredPuts = upload.posterSize ? 2 : 1;
  const reserved = await env.DB.prepare(`UPDATE gallery_state
    SET reserved_bytes = reserved_bytes + ?, reserved_images = reserved_images + ?,
        daily_sources = daily_sources + 1, daily_puts = daily_puts + ?
    WHERE id = 1
      AND used_bytes + reserved_bytes + ? <= ?
      AND image_count + reserved_images + ? <= ?
      AND daily_sources + 1 <= ?
      AND daily_puts + ? <= ?`)
    .bind(requiredBytes, upload.isImage ? 1 : 0, requiredPuts, requiredBytes, MAX_R2_BYTES,
      upload.isImage ? 1 : 0, MAX_IMAGES, MAX_DAILY_SOURCES, requiredPuts, MAX_DAILY_PUTS).run();
  if (!reserved.meta?.changes) return json(request, { error: "The free gallery capacity has been reached. No upload was charged." }, 507);

  const id = crypto.randomUUID();
  const date = day;
  const sourceKey = `originals/${date}/${id}${extensionFor(upload.fileName, upload.contentType)}`;
  const posterKey = upload.posterSize ? `posters/${date}/${id}.jpg` : null;
  try {
    await env.DB.prepare(`INSERT INTO upload_sessions
      (id, source_key, poster_key, content_type, source_size, poster_size, original_name, uploader, reserved_image, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, sourceKey, posterKey, upload.contentType, upload.sourceSize, upload.posterSize,
        upload.fileName, upload.uploader, upload.isImage ? 1 : 0, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString()).run();
  } catch (error) {
    await releaseReservation(env, requiredBytes, upload.isImage ? 1 : 0);
    console.error("Upload reservation failed", { message: error?.message });
    return json(request, { error: "The upload could not be prepared." }, 503);
  }
  return json(request, { uploadId: id, sourceUrl: `/uploads/${id}/source`, posterUrl: posterKey ? `/uploads/${id}/poster` : null }, 201);
}

async function getSession(env, id) {
  return env.DB.prepare("SELECT * FROM upload_sessions WHERE id = ?").bind(id).first();
}

async function releaseReservation(env, bytes, imageCount) {
  await env.DB.prepare(`UPDATE gallery_state
    SET reserved_bytes = MAX(0, reserved_bytes - ?), reserved_images = MAX(0, reserved_images - ?)
    WHERE id = 1`).bind(bytes, imageCount).run();
}

async function uploadSessionPart(request, env, id, part) {
  if (request.headers.get("X-Event-Code") !== env.EVENT_CODE) return json(request, { error: "That event code is not recognised." }, 401);
  const session = await getSession(env, id);
  if (!session || session.expires_at <= new Date().toISOString()) return json(request, { error: "This upload session has expired." }, 410);
  const isPoster = part === "poster";
  const expectedSize = Number(isPoster ? session.poster_size : session.source_size);
  const key = isPoster ? session.poster_key : session.source_key;
  const alreadyUploaded = Number(isPoster ? session.poster_uploaded : session.source_uploaded);
  if (!key || expectedSize <= 0) return json(request, { error: "This upload part is not expected." }, 404);
  if (alreadyUploaded) return json(request, { error: "This upload part is already complete." }, 409);
  const contentLength = Number(request.headers.get("Content-Length"));
  const contentType = String(request.headers.get("Content-Type") || "").split(";", 1)[0].toLowerCase();
  const expectedType = isPoster ? POSTER_TYPE : session.content_type;
  if (!request.body || contentLength !== expectedSize || contentType !== expectedType) {
    return json(request, { error: "The upload size or type did not match its reservation." }, 400);
  }
  try {
    await env.UPLOADS.put(key, request.body, {
      httpMetadata: { contentType, contentDisposition: `attachment; filename="${isPoster ? "video-preview.jpg" : session.original_name}"` },
      customMetadata: { uploadedAt: session.created_at, uploader: session.uploader, uploadId: session.id }
    });
    await env.DB.prepare(`UPDATE upload_sessions SET ${isPoster ? "poster_uploaded" : "source_uploaded"} = 1 WHERE id = ?`).bind(id).run();
    return json(request, { uploaded: true });
  } catch (error) {
    console.error("Upload part failed", { id, part, message: error?.message });
    return json(request, { error: "The upload could not be saved. Please try again." }, 503);
  }
}

async function cancelUpload(request, env, id) {
  if (request.headers.get("X-Event-Code") !== env.EVENT_CODE) return json(request, { error: "That event code is not recognised." }, 401);
  const session = await getSession(env, id);
  if (!session) return new Response(null, { status: 204, headers: corsHeaders(request) });
  await Promise.all([
    session.source_uploaded ? env.UPLOADS.delete(session.source_key) : Promise.resolve(),
    session.poster_uploaded && session.poster_key ? env.UPLOADS.delete(session.poster_key) : Promise.resolve()
  ]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM upload_sessions WHERE id = ?").bind(id),
    env.DB.prepare(`UPDATE gallery_state SET reserved_bytes = MAX(0, reserved_bytes - ?),
      reserved_images = MAX(0, reserved_images - ?) WHERE id = 1`)
      .bind(Number(session.source_size) + Number(session.poster_size), Number(session.reserved_image))
  ]);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function publishUpload(request, env, id) {
  if (request.headers.get("X-Event-Code") !== env.EVENT_CODE) return json(request, { error: "That event code is not recognised." }, 401);
  const session = await getSession(env, id);
  if (!session) return json(request, { error: "This upload session was not found." }, 404);
  if (!session.source_uploaded || (session.poster_size && !session.poster_uploaded)) {
    return json(request, { error: "The upload is not complete yet." }, 409);
  }
  const [source, poster] = await Promise.all([
    env.UPLOADS.head(session.source_key),
    session.poster_key ? env.UPLOADS.head(session.poster_key) : Promise.resolve(null)
  ]);
  if (!source || source.size !== session.source_size || (session.poster_key && (!poster || poster.size !== session.poster_size))) {
    await cancelUpload(request, env, id);
    return json(request, { error: "The stored upload could not be verified." }, 503);
  }
  const committedBytes = Number(session.source_size) + Number(session.poster_size);
  const fingerprint = `${source.size}:${source.etag}`;
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO media
        (id, r2_key, content_type, size, etag, fingerprint, uploaded_at, original_name, uploader, poster_key, published)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(session.source_key, session.source_key, session.content_type, source.size, source.etag, fingerprint,
          session.created_at, session.original_name, session.uploader, session.poster_key),
      env.DB.prepare(`UPDATE gallery_state SET used_bytes = used_bytes + ?, reserved_bytes = MAX(0, reserved_bytes - ?),
        image_count = image_count + ?, reserved_images = MAX(0, reserved_images - ?), total_count = total_count + 1 WHERE id = 1`)
        .bind(committedBytes, committedBytes, Number(session.reserved_image), Number(session.reserved_image)),
      env.DB.prepare("DELETE FROM upload_sessions WHERE id = ?").bind(id)
    ]);
  } catch (error) {
    console.error("Upload publish failed", { id, message: error?.message });
    await cancelUpload(request, env, id);
    return json(request, { error: "This file is already in the album or could not be published." }, 409);
  }
  return json(request, { item: publicItem(request, {
    id: session.source_key,
    content_type: session.content_type,
    uploaded_at: session.created_at,
    poster_key: session.poster_key
  }) }, 201);
}

async function cleanupExpiredSessions(env) {
  const expired = await env.DB.prepare("SELECT * FROM upload_sessions WHERE expires_at <= ? LIMIT 50")
    .bind(new Date().toISOString()).all();
  for (const session of expired.results || []) {
    await Promise.all([
      session.source_uploaded ? env.UPLOADS.delete(session.source_key) : Promise.resolve(),
      session.poster_uploaded && session.poster_key ? env.UPLOADS.delete(session.poster_key) : Promise.resolve()
    ]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM upload_sessions WHERE id = ?").bind(session.id),
      env.DB.prepare(`UPDATE gallery_state SET reserved_bytes = MAX(0, reserved_bytes - ?),
        reserved_images = MAX(0, reserved_images - ?) WHERE id = 1`)
        .bind(Number(session.source_size) + Number(session.poster_size), Number(session.reserved_image))
    ]);
  }
}

async function listAllObjects(env) {
  const objects = [];
  let cursor;
  do {
    const listed = await env.UPLOADS.list({ cursor, limit: 1000, include: ["httpMetadata", "customMetadata"] });
    objects.push(...listed.objects);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return objects;
}

async function reconcileGallery(request, env) {
  if (!env.ADMIN_TOKEN || request.headers.get("X-Admin-Token") !== env.ADMIN_TOKEN) {
    return json(request, { error: "Not found." }, 404);
  }
  const objects = await listAllObjects(env);
  const originals = objects.filter((object) => object.key.startsWith("originals/"));
  const seenFingerprints = new Set();
  const statements = [];
  for (const object of originals.sort((a, b) => b.key.localeCompare(a.key))) {
    const fingerprint = `${object.size}:${object.etag}`;
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    const contentType = object.httpMetadata?.contentType === "application/octet-stream"
      ? contentTypeForKey(object.key)
      : object.httpMetadata?.contentType || contentTypeForKey(object.key);
    const uploadedAt = object.customMetadata?.uploadedAt || object.uploaded?.toISOString?.() || new Date(0).toISOString();
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO media
      (id, r2_key, content_type, size, etag, fingerprint, uploaded_at, original_name, uploader, poster_key, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`)
      .bind(object.key, object.key, contentType, object.size, object.etag, fingerprint, uploadedAt,
        object.customMetadata?.originalName || object.key.split("/").at(-1), object.customMetadata?.uploader || ""));
  }
  for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
  const aggregate = await env.DB.prepare(`SELECT COUNT(*) AS total_count,
    SUM(CASE WHEN content_type LIKE 'image/%' THEN 1 ELSE 0 END) AS image_count FROM media WHERE published = 1`).first();
  const usedBytes = objects.reduce((sum, object) => sum + object.size, 0);
  await env.DB.prepare(`UPDATE gallery_state SET used_bytes = ?, image_count = ?, total_count = ?,
    reserved_bytes = 0, reserved_images = 0 WHERE id = 1`)
    .bind(usedBytes, Number(aggregate?.image_count || 0), Number(aggregate?.total_count || 0)).run();
  return json(request, { objectCount: objects.length, usedBytes, publishedCount: Number(aggregate?.total_count || 0), imageCount: Number(aggregate?.image_count || 0) });
}

async function routeRequest(request, env, context) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/gallery") return handleGallery(request, env);
  if (request.method === "GET" && path.startsWith("/media/")) return handleMedia(request, env, context, path.slice(7));
  if (request.method === "GET" && path.startsWith("/image/")) {
    const match = path.match(/^\/image\/(480|800|1200)\/(.+)$/);
    return match ? handleImage(request, env, context, match[1], match[2]) : json(request, { error: "Not found." }, 404);
  }
  if (request.method === "POST" && path === "/uploads") return reserveUpload(request, env);
  const uploadMatch = path.match(/^\/uploads\/([a-f0-9-]+)(?:\/(source|poster|publish))?$/);
  if (uploadMatch) {
    const [, id, action] = uploadMatch;
    if (request.method === "PUT" && (action === "source" || action === "poster")) return uploadSessionPart(request, env, id, action);
    if (request.method === "POST" && action === "publish") return publishUpload(request, env, id);
    if (request.method === "DELETE" && !action) return cancelUpload(request, env, id);
  }
  if (request.method === "POST" && path === "/admin/reconcile") return reconcileGallery(request, env);
  return json(request, { error: "Not found." }, 404);
}

export default {
  async fetch(request, env, context) {
    try {
      return await routeRequest(request, env, context);
    } catch (error) {
      console.error("Request failed", { path: new URL(request.url).pathname, message: error?.message });
      return json(request, { error: "The gallery service is temporarily unavailable." }, 503);
    }
  },

  async scheduled(_controller, env) {
    await cleanupExpiredSessions(env);
  }
};

export const __test = {
  base64UrlDecode,
  base64UrlEncode,
  contentTypeForKey,
  noUnexpectedQuery,
  publicItem,
  validateUploadRequest
};
