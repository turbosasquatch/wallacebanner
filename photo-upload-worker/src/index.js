const MAX_BYTES = 25 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 100;
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Event-Code, X-File-Name, X-Uploader-Name",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
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
    if (request.method !== "POST" || new URL(request.url).pathname !== "/upload") return json(request, { error: "Not found." }, 404);
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
