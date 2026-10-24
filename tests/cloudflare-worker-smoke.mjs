import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

const workerSource = await readFile(new URL("../cloudflare/worker.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(workerSource).toString("base64"));

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
publicJwk.kid = "test-google-key";
publicJwk.use = "sig";
publicJwk.alg = "RS256";

globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
  return new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
};

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function makeToken(sub = "google-user-1", overrides = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-google-key" }));
  const claims = base64url(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "test-client-id",
    sub,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }));
  const input = header + "." + claims;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  return input + "." + Buffer.from(signature).toString("base64url");
}

const rows = new Map();
const env = {
  GOOGLE_CLIENT_ID: "test-client-id",
  ALLOWED_ORIGINS: "https://example.test",
  DB: {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() {
          const userId = values[0];
          const row = rows.get(userId);
          if (sql.startsWith("SELECT save_data")) return row ? { ...row } : null;
          if (sql.startsWith("SELECT revision")) return row ? { revision: row.revision } : null;
          throw new Error("Unexpected SELECT: " + sql);
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE")) {
            const [userId, saveData, variantsData, autoCropsData, schemaVersion, updatedAt] = values;
            if (rows.has(userId)) return { meta: { changes: 0 } };
            rows.set(userId, { save_data: saveData, variants_data: variantsData, auto_crops_data: autoCropsData, schema_version: schemaVersion, revision: 1, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE player_saves")) {
            const [saveData, variantsData, autoCropsData, schemaVersion, updatedAt, userId, revision] = values;
            const row = rows.get(userId);
            if (!row || row.revision !== revision) return { meta: { changes: 0 } };
            rows.set(userId, { save_data: saveData, variants_data: variantsData, auto_crops_data: autoCropsData, schema_version: schemaVersion, revision: revision + 1, updated_at: updatedAt });
            return { meta: { changes: 1 } };
          }
          throw new Error("Unexpected statement: " + sql);
        },
      };
      return statement;
    },
  },
};

const testSessionOpenedAt = Date.now();

async function call(method, { token, body, origin = "https://example.test", path = "/api/save" } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (token) {
    headers.set("Authorization", "Bearer " + token);
    if (method === "GET" || method === "PUT") headers.set("X-DianGarden-Opened-At", String(testSessionOpenedAt));
  }
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const payload = body === undefined ? undefined : { ...body, openedAt: body.openedAt ?? testSessionOpenedAt };
  return worker.fetch(new Request("https://worker.example" + path, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }), env);
}

const preflight = await call("OPTIONS");
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), "https://example.test");

const deniedOrigin = await call("GET", { origin: "https://evil.test" });
assert.equal(deniedOrigin.status, 403);

const missingAuth = await call("GET");
assert.equal(missingAuth.status, 401);

const token = await makeToken();
const missingSave = await call("GET", { token });
assert.equal(missingSave.status, 200);
assert.deepEqual(await missingSave.json(), { status: "not_found", revision: 0 });

const initialSave = {
  schemaVersion: 1,
  baseRevision: 0,
  saveData: JSON.stringify({ coins: 120, plots: [] }),
  variantsData: "[]",
  autoCropsData: "[0,1]",
};
const created = await call("PUT", { token, body: initialSave });
assert.equal(created.status, 201);
assert.equal((await created.json()).revision, 1);

const staleWrite = await call("PUT", { token, body: initialSave });
assert.equal(staleWrite.status, 409);
assert.equal((await staleWrite.json()).revision, 1);

const updated = await call("PUT", { token, body: { ...initialSave, baseRevision: 1, saveData: JSON.stringify({ coins: 200, plots: [] }) } });
assert.equal(updated.status, 200);
assert.equal((await updated.json()).revision, 2);

const anotherUser = await call("GET", { token: await makeToken("google-user-2") });
assert.deepEqual(await anotherUser.json(), { status: "not_found", revision: 0 });

const badAudience = await call("GET", { token: await makeToken("google-user-1", { aud: "wrong-client-id" }) });
assert.equal(badAudience.status, 401);

const tooLarge = await call("PUT", { token, body: { ...initialSave, baseRevision: 2, saveData: JSON.stringify({ value: "x".repeat(270_000) }) } });
assert.equal(tooLarge.status, 400);

console.log("Cloudflare Worker smoke tests passed: CORS, auth, isolated users, save/load, revision conflicts, validation.");
