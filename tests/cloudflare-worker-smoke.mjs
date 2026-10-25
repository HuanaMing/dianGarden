import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
const workerSource = await readFile(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(workerSource).toString("base64"));
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
Object.assign(publicJwk, { kid: "test-google-key", use: "sig", alg: "RS256" });
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
  return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
};
function base64url(value) { return Buffer.from(value).toString("base64url"); }
async function makeToken(sub = "google-user-1", overrides = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-google-key" }));
  const claims = base64url(JSON.stringify({ iss: "https://accounts.google.com", aud: "test-client-id", sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...overrides }));
  const input = header + "." + claims;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  return input + "." + Buffer.from(signature).toString("base64url");
}
const saves = new Map();
const sessions = new Map();
const env = {
  GOOGLE_CLIENT_ID: "test-client-id",
  ALLOWED_ORIGINS: "https://example.test",
  DB: {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() {
          if (sql.startsWith("SELECT save_data")) return saves.has(values[0]) ? { ...saves.get(values[0]) } : null;
          if (sql.startsWith("SELECT revision")) {
            const row = saves.get(values[0]);
            return row ? { revision: row.revision, opened_at: row.opened_at } : null;
          }
          if (sql.startsWith("SELECT session_id")) return sessions.has(values[0]) ? { ...sessions.get(values[0]) } : null;
          throw new Error("Unexpected SELECT: " + sql);
        },
        async run() {
          if (sql.startsWith("INSERT INTO player_sessions")) {
            const [session_id, user_id, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, created_at, last_seen_at] = values;
            if (sessions.has(session_id)) return { meta: { changes: 0 } };
            sessions.set(session_id, { session_id, user_id, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, created_at, last_seen_at, revoked_at: null });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_sessions SET revoked_at")) {
            const [revoked_at, session_id] = values;
            const row = sessions.get(session_id);
            if (!row || row.revoked_at != null) return { meta: { changes: 0 } };
            sessions.set(session_id, { ...row, revoked_at });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_sessions SET refresh_token_hash")) {
            const [refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, last_seen_at, session_id, previousHash] = values;
            const row = sessions.get(session_id);
            if (!row || row.revoked_at != null || row.refresh_token_hash !== previousHash) return { meta: { changes: 0 } };
            sessions.set(session_id, { ...row, refresh_token_hash, access_token_hash, access_expires_at, idle_expires_at, last_seen_at });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_sessions SET idle_expires_at")) {
            const [idle_expires_at, last_seen_at, session_id] = values;
            const row = sessions.get(session_id);
            if (!row || row.revoked_at != null) return { meta: { changes: 0 } };
            sessions.set(session_id, { ...row, idle_expires_at, last_seen_at });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_saves SET opened_at")) {
            const [openedAt, userId, minimumOpenedAt] = values;
            const row = saves.get(userId);
            if (!row || (row.opened_at != null && row.opened_at > minimumOpenedAt)) return { meta: { changes: 0 } };
            saves.set(userId, { ...row, opened_at: openedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("INSERT OR IGNORE")) {
            const [userId, saveData, variantsData, autoCropsData, schemaVersion, updatedAt, openedAt, savedAt] = values;
            if (saves.has(userId)) return { meta: { changes: 0 } };
            saves.set(userId, { save_data: saveData, variants_data: variantsData, auto_crops_data: autoCropsData, schema_version: schemaVersion, revision: 1, updated_at: updatedAt, opened_at: openedAt, saved_at: savedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_saves SET save_data")) {
            const [saveData, variantsData, autoCropsData, schemaVersion, updatedAt, savedAt, userId, revision, openedAt] = values;
            const row = saves.get(userId);
            if (!row || row.revision !== revision || row.opened_at !== openedAt) return { meta: { changes: 0 } };
            saves.set(userId, { ...row, save_data: saveData, variants_data: variantsData, auto_crops_data: autoCropsData, schema_version: schemaVersion, revision: revision + 1, updated_at: updatedAt, saved_at: savedAt });
            return { meta: { changes: 1 } };
          }
          throw new Error("Unexpected statement: " + sql);
        },
      };
      return statement;
    },
  },
};
async function call(method, { token, body, origin = "https://example.test", path = "/api/save", openedAt = Date.now() } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (token) headers.set("Authorization", "Bearer " + token);
  if (path === "/api/save" && token && ["GET", "PUT"].includes(method)) headers.set("X-DianGarden-Opened-At", String(openedAt));
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request("https://worker.example" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
async function createSession(sub = "google-user-1") {
  const response = await call("POST", { path: "/api/session", body: { idToken: await makeToken(sub) } });
  assert.equal(response.status, 201);
  return response.json();
}

const preflight = await call("OPTIONS");
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), "https://example.test");
assert.equal((await call("GET", { origin: "https://evil.test" })).status, 403);
assert.equal((await call("GET")).status, 401);
assert.equal((await call("POST", { path: "/api/session", body: { idToken: await makeToken("x", { aud: "wrong" }) } })).status, 401);

const session = await createSession();
assert.ok(session.accessToken);
assert.ok(session.refreshToken);
assert.ok(session.accessExpiresAt > Math.floor(Date.now() / 1000));
assert.equal((await call("GET", { token: session.accessToken })).status, 200);
const openedAt = Date.now();
const missingSave = await call("GET", { token: session.accessToken, openedAt });
assert.deepEqual(await missingSave.json(), { status: "not_found", revision: 0 });

const initialSave = { schemaVersion: 1, baseRevision: 0, saveData: JSON.stringify({ coins: 120, plots: [] }), variantsData: "[]", autoCropsData: "[0,1]", openedAt, savedAt: openedAt };
const created = await call("PUT", { token: session.accessToken, body: initialSave, openedAt });
assert.equal(created.status, 201);
const staleWrite = await call("PUT", { token: session.accessToken, body: initialSave, openedAt });
assert.equal(staleWrite.status, 409);
assert.equal((await staleWrite.json()).revision, 1);
const updated = await call("PUT", { token: session.accessToken, body: { ...initialSave, baseRevision: 1, saveData: JSON.stringify({ coins: 200, plots: [] }) }, openedAt });
assert.equal(updated.status, 200);
assert.equal((await updated.json()).revision, 2);

const otherSession = await createSession("google-user-2");
assert.deepEqual(await (await call("GET", { token: otherSession.accessToken })).json(), { status: "not_found", revision: 0 });
const badAccess = await call("GET", { token: session.accessToken + "x", openedAt });
assert.equal(badAccess.status, 401);

const oldRefresh = session.refreshToken;
const rotated = await (await call("POST", { path: "/api/session/refresh", body: { refreshToken: oldRefresh } })).json();
assert.ok(rotated.accessToken);
assert.notEqual(rotated.refreshToken, oldRefresh);
assert.equal((await call("GET", { token: rotated.accessToken, openedAt })).status, 200);

const replaySession = await createSession("replay-user");
const replay = await call("POST", { path: "/api/session/refresh", body: { refreshToken: replaySession.refreshToken } });
assert.equal(replay.status, 200);
const replayedOldToken = await call("POST", { path: "/api/session/refresh", body: { refreshToken: replaySession.refreshToken } });
assert.equal(replayedOldToken.status, 401);
const revokedAccess = await call("GET", { token: replaySession.accessToken });
assert.equal(revokedAccess.status, 401);

const expired = sessions.get(rotated.accessToken.split(".")[0]);
sessions.set(expired.session_id, { ...expired, access_expires_at: Math.floor(Date.now() / 1000) - 1 });
assert.equal((await call("GET", { token: rotated.accessToken, openedAt })).status, 401);

const logout = await call("POST", { path: "/api/session/logout", body: { refreshToken: rotated.refreshToken } });
assert.equal(logout.status, 200);
assert.equal((await call("GET", { token: rotated.accessToken, openedAt })).status, 401);

const newerSessionOpenedAt = openedAt + 1000;
assert.equal((await call("GET", { token: rotated.accessToken, openedAt: newerSessionOpenedAt })).status, 401);
console.log("Cloudflare Worker smoke tests passed: Google login, session creation/refresh/rotation/replay/logout, token expiry, CORS, user isolation, save revisions and ownership.");
