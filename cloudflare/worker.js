const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_BODY_BYTES = 256 * 1024;
const SCHEMA_VERSION = 1;
let cachedJwks = null;
let cachedJwksExpiresAt = 0;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, DELETE, POST, OPTIONS",
    "access-control-allow-headers": "Authorization, Content-Type, X-DianGarden-Opened-At",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getGoogleJwks() {
  if (cachedJwks && Date.now() < cachedJwksExpiresAt) return cachedJwks;
  const response = await fetch(GOOGLE_JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Google signing keys are unavailable");
  const jwks = await response.json();
  if (!Array.isArray(jwks.keys)) throw new Error("Invalid Google signing keys response");
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  cachedJwks = jwks;
  cachedJwksExpiresAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  return jwks;
}


const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const IDLE_TTL_SECONDS = 30 * 24 * 60 * 60;
function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
function makeSessionToken(sessionId) { return sessionId + "." + randomSecret(); }
function tokenSessionId(token) {
  if (typeof token !== "string") return null;
  const separator = token.indexOf(".");
  return separator > 0 && separator <= 128 && separator < token.length - 1 ? token.slice(0, separator) : null;
}
async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function readSessionToken(request, property) {
  try { const body = await readRequestJson(request); return typeof body?.[property] === "string" ? body[property] : ""; }
  catch (_) { return ""; }
}
async function createSession(userId, env) {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const accessToken = makeSessionToken(sessionId);
  const refreshToken = makeSessionToken(sessionId);
  const accessHash = await hashToken(accessToken);
  const refreshHash = await hashToken(refreshToken);
  await env.DB.prepare("INSERT INTO player_sessions (session_id, user_id, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)")
    .bind(sessionId, userId, refreshHash, accessHash, now + ACCESS_TOKEN_TTL_SECONDS, now + IDLE_TTL_SECONDS, now, now).run();
  return jsonResponse({ accessToken, accessExpiresAt: now + ACCESS_TOKEN_TTL_SECONDS, refreshToken, idleExpiresAt: now + IDLE_TTL_SECONDS, userId }, 201);
}
async function refreshSession(refreshToken, env) {
  const sessionId = tokenSessionId(refreshToken);
  if (!sessionId) return jsonResponse({ error: "invalid_refresh_token" }, 401);
  const row = await env.DB.prepare("SELECT session_id, user_id, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, revoked_at FROM player_sessions WHERE session_id = ?").bind(sessionId).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.revoked_at != null || row.idle_expires_at <= now) return jsonResponse({ error: "session_expired" }, 401);
  const presentedHash = await hashToken(refreshToken);
  if (presentedHash !== row.refresh_token_hash) {
    await env.DB.prepare("UPDATE player_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").bind(now, sessionId).run();
    return jsonResponse({ error: "refresh_token_reused" }, 401);
  }
  const accessToken = makeSessionToken(sessionId);
  const nextRefreshToken = makeSessionToken(sessionId);
  const accessHash = await hashToken(accessToken);
  const refreshHash = await hashToken(nextRefreshToken);
  const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
  const idleExpiresAt = now + IDLE_TTL_SECONDS;
  const result = await env.DB.prepare("UPDATE player_sessions SET refresh_token_hash = ?, access_token_hash = ?, access_expires_at = ?, idle_expires_at = ?, last_seen_at = ? WHERE session_id = ? AND refresh_token_hash = ? AND revoked_at IS NULL")
    .bind(refreshHash, accessHash, accessExpiresAt, idleExpiresAt, now, sessionId, presentedHash).run();
  if (result.meta?.changes !== 1) return jsonResponse({ error: "session_expired" }, 401);
  return jsonResponse({ accessToken, accessExpiresAt, refreshToken: nextRefreshToken, idleExpiresAt, userId: row.user_id });
}
async function revokeSession(refreshToken, env) {
  const sessionId = tokenSessionId(refreshToken);
  if (sessionId) await env.DB.prepare("UPDATE player_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL").bind(Math.floor(Date.now() / 1000), sessionId).run();
  return jsonResponse({ status: "signed_out" });
}
async function authenticateAccessToken(request, env) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return { response: jsonResponse({ error: "authentication_required" }, 401) };
  const token = match[1];
  const sessionId = tokenSessionId(token);
  if (!sessionId) return { response: jsonResponse({ error: "invalid_access_token" }, 401) };
  const row = await env.DB.prepare("SELECT session_id, user_id, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, revoked_at FROM player_sessions WHERE session_id = ?").bind(sessionId).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.revoked_at != null || row.idle_expires_at <= now) return { response: jsonResponse({ error: "session_expired" }, 401) };
  if (await hashToken(token) !== row.access_token_hash) return { response: jsonResponse({ error: "invalid_access_token" }, 401) };
  if (row.access_expires_at <= now) return { response: jsonResponse({ error: "access_token_expired" }, 401) };
  await env.DB.prepare("UPDATE player_sessions SET idle_expires_at = ?, last_seen_at = ? WHERE session_id = ? AND revoked_at IS NULL").bind(now + IDLE_TTL_SECONDS, now, sessionId).run();
  return { userId: row.user_id };
}

async function verifyGoogleIdToken(token, expectedAudience) {
  if (!expectedAudience) throw new Error("Google sign-in is not configured");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported token signature");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("Invalid token issuer");
  if (claims.aud !== expectedAudience) throw new Error("Invalid token audience");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new Error("Invalid user subject");
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Expired ID token");
  if (Number.isFinite(claims.iat) && claims.iat > now + 60) throw new Error("ID token issued in the future");

  const jwks = await getGoogleJwks();
  const jwk = jwks.keys.find((key) => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
  if (!jwk) {
    cachedJwks = null;
    cachedJwksExpiresAt = 0;
    throw new Error("Unknown Google signing key");
  }
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = decodeBase64Url(parts[2]);
  const signedContent = new TextEncoder().encode(parts[0] + "." + parts[1]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signedContent)) throw new Error("Invalid ID token signature");
  return claims.sub;
}

function parseJsonComponent(value, name, acceptedTypes) {
  if (typeof value !== "string" || value.length > MAX_BODY_BYTES) throw new Error(name + " must be a JSON string");
  let parsed;
  try { parsed = JSON.parse(value); } catch (_) { throw new Error(name + " is not valid JSON"); }
  const type = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
  if (!acceptedTypes.includes(type)) throw new Error(name + " has an invalid JSON type");
  return value;
}

function validateSavePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Expected a save object");
  if (payload.schemaVersion !== SCHEMA_VERSION) throw new Error("Unsupported save schema version");
  if (!Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0) throw new Error("baseRevision must be a non-negative integer");
  if (!Number.isSafeInteger(payload.openedAt) || payload.openedAt <= 0) throw new Error("openedAt must be a positive integer timestamp");
  if (!Number.isSafeInteger(payload.savedAt) || payload.savedAt <= 0) throw new Error("savedAt must be a positive integer timestamp");
  return {
    baseRevision: payload.baseRevision,
    openedAt: payload.openedAt,
    savedAt: payload.savedAt,
    saveData: parseJsonComponent(payload.saveData, "saveData", ["object"]),
    variantsData: parseJsonComponent(payload.variantsData, "variantsData", ["array"]),
    autoCropsData: parseJsonComponent(payload.autoCropsData, "autoCropsData", ["array"]),
  };
}

async function readRequestJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error("Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error("Request body is too large");
  try { return JSON.parse(text); } catch (_) { throw new Error("Request body must be valid JSON"); }
}

// A server-issued, monotonically increasing timestamp makes the newest GET session the owner,
// without storing a browser/device identifier. The accepted timestamp is returned to that session.
async function handleGetSave(userId, request, env) {
  const openedAt = Number(request.headers.get("X-DianGarden-Opened-At") || 0);
  if (!Number.isSafeInteger(openedAt) || openedAt <= 0) return jsonResponse({ error: "invalid_session" }, 400);
  const row = await env.DB.prepare(
    "SELECT save_data, variants_data, auto_crops_data, schema_version, revision, updated_at, opened_at, saved_at FROM player_saves WHERE user_id = ?",
  ).bind(userId).first();

  if (!row) return jsonResponse({ status: "not_found", revision: 0 });
  if (row.opened_at != null && openedAt < row.opened_at) return jsonResponse({ error: "stale_session" }, 409);
  const claimed = await env.DB.prepare(
    "UPDATE player_saves SET opened_at = ? WHERE user_id = ? AND (opened_at IS NULL OR opened_at <= ?)",
  ).bind(openedAt, userId, openedAt).run();
  if (claimed.meta?.changes !== 1) return jsonResponse({ error: "session_claim_failed" }, 409);

  return jsonResponse({
    status: "ok",
    openedAt,
    save: {
      saveData: row.save_data,
      variantsData: row.variants_data,
      autoCropsData: row.auto_crops_data,
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
      savedAt: row.saved_at,
      openedAt,
    },
  });
}

async function handleDeleteSave(userId, request, env) {
  let payload;
  try { payload = await readRequestJson(request); }
  catch (error) { return jsonResponse({ error: error.message }, 400); }
  if (!payload || !Number.isSafeInteger(payload.baseRevision) || payload.baseRevision < 0
    || !Number.isSafeInteger(payload.openedAt) || payload.openedAt <= 0) {
    return jsonResponse({ error: "invalid_reset_request" }, 400);
  }
  const sessionOpenedAt = Number(request.headers.get("X-DianGarden-Opened-At") || 0);
  if (sessionOpenedAt !== payload.openedAt) return jsonResponse({ error: "invalid_session" }, 400);

  const row = await env.DB.prepare("SELECT revision, opened_at FROM player_saves WHERE user_id = ?").bind(userId).first();
  if (!row) return jsonResponse({ status: "deleted", deleted: false, revision: 0 });
  if (row.opened_at !== payload.openedAt) return jsonResponse({ error: "stale_session", revision: row.revision }, 409);
  if (row.revision !== payload.baseRevision) return jsonResponse({ error: "revision_conflict", revision: row.revision }, 409);

  const result = await env.DB.prepare(
    "DELETE FROM player_saves WHERE user_id = ? AND revision = ? AND opened_at = ?",
  ).bind(userId, payload.baseRevision, payload.openedAt).run();
  if (result.meta?.changes !== 1) {
    const current = await env.DB.prepare("SELECT revision, opened_at FROM player_saves WHERE user_id = ?").bind(userId).first();
    if (!current) return jsonResponse({ status: "deleted", deleted: false, revision: 0 });
    return jsonResponse({ error: current.opened_at !== payload.openedAt ? "stale_session" : "revision_conflict", revision: current.revision }, 409);
  }
  return jsonResponse({ status: "deleted", deleted: true, revision: 0 });
}

async function handlePutSave(userId, request, env) {
  let payload;
  try { payload = validateSavePayload(await readRequestJson(request)); }
  catch (error) { return jsonResponse({ error: error.message }, 400); }

  const sessionOpenedAt = Number(request.headers.get("X-DianGarden-Opened-At") || 0);
  if (!Number.isSafeInteger(sessionOpenedAt) || sessionOpenedAt <= 0 || sessionOpenedAt !== payload.openedAt) {
    return jsonResponse({ error: "invalid_session" }, 400);
  }
  const now = new Date().toISOString();
  if (payload.baseRevision === 0) {
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO player_saves (user_id, save_data, variants_data, auto_crops_data, schema_version, revision, updated_at, opened_at, saved_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
    ).bind(userId, payload.saveData, payload.variantsData, payload.autoCropsData, SCHEMA_VERSION, now, payload.openedAt, payload.savedAt).run();
    if (result.meta?.changes !== 1) {
      const current = await env.DB.prepare("SELECT revision, opened_at FROM player_saves WHERE user_id = ?").bind(userId).first();
      return jsonResponse({ error: current?.opened_at !== payload.openedAt ? "stale_session" : "revision_conflict", revision: current?.revision ?? 0 }, 409);
    }
    return jsonResponse({ status: "saved", revision: 1, updatedAt: now, savedAt: payload.savedAt }, 201);
  }

  const result = await env.DB.prepare(
    "UPDATE player_saves SET save_data = ?, variants_data = ?, auto_crops_data = ?, schema_version = ?, revision = revision + 1, updated_at = ?, saved_at = ? WHERE user_id = ? AND revision = ? AND opened_at = ?",
  ).bind(payload.saveData, payload.variantsData, payload.autoCropsData, SCHEMA_VERSION, now, payload.savedAt, userId, payload.baseRevision, payload.openedAt).run();

  if (result.meta?.changes !== 1) {
    const current = await env.DB.prepare("SELECT revision, opened_at FROM player_saves WHERE user_id = ?").bind(userId).first();
    return jsonResponse({ error: current?.opened_at !== payload.openedAt ? "stale_session" : "revision_conflict", revision: current?.revision ?? 0 }, 409);
  }
  return jsonResponse({ status: "saved", revision: payload.baseRevision + 1, updatedAt: now, savedAt: payload.savedAt });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const origins = allowedOrigins(env);
    const headers = corsHeaders(request, env);
    if (origin && !origins.includes(origin)) return jsonResponse({ error: "origin_not_allowed" }, 403);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!["/api/save", "/api/session", "/api/session/refresh", "/api/session/logout"].includes(url.pathname)) return jsonResponse({ error: "not_found" }, 404, headers);
    if (!env.DB) return jsonResponse({ error: "database_not_configured" }, 503, headers);
    try {
      let response;
      if (url.pathname === "/api/session") {
        if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...headers });
        if (!env.GOOGLE_CLIENT_ID) return jsonResponse({ error: "google_sign_in_not_configured" }, 503, headers);
        const idToken = await readSessionToken(request, "idToken");
        if (!idToken) return jsonResponse({ error: "authentication_required" }, 401, headers);
        let userId;
        try { userId = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID); }
        catch (_) { return jsonResponse({ error: "invalid_google_id_token" }, 401, headers); }
        response = await createSession(userId, env);
      } else if (url.pathname === "/api/session/refresh") {
        if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...headers });
        response = await refreshSession(await readSessionToken(request, "refreshToken"), env);
      } else if (url.pathname === "/api/session/logout") {
        if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...headers });
        response = await revokeSession(await readSessionToken(request, "refreshToken"), env);
      } else {
        if (!["GET", "PUT", "DELETE"].includes(request.method)) return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "GET, PUT, DELETE, OPTIONS", ...headers });
        const auth = await authenticateAccessToken(request, env);
        if (auth.response) {
          const responseHeaders = new Headers(auth.response.headers);
          for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
          return new Response(auth.response.body, { status: auth.response.status, headers: responseHeaders });
        }
        response = request.method === "GET" ? await handleGetSave(auth.userId, request, env) : request.method === "DELETE" ? await handleDeleteSave(auth.userId, request, env) : await handlePutSave(auth.userId, request, env);
      }
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch (_) {
      return jsonResponse({ error: "storage_unavailable" }, 503, headers);
    }
  },
};
