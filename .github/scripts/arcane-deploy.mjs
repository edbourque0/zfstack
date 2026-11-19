// Deploys ZFStack to an Arcane project: refreshes the ghcr.io pull credential,
// pins the new image in the project's compose file, redeploys and waits for health.
// Runs in GitHub Actions with Node 20+ (global fetch).
import { readFileSync } from "node:fs";

const env = (k, fallback) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing ${k}`);
  return v;
};

const ARCANE_URL = env("ARCANE_URL").replace(/\/+$/, "");
const API_KEY = env("ARCANE_API_KEY");
const ENV_ID = env("ARCANE_ENV_ID", "0");
const PROJECT_ID = env("ARCANE_PROJECT_ID");
const IMAGE = env("IMAGE");
const REGISTRY_USER = process.env.REGISTRY_USER ?? "";
const REGISTRY_TOKEN = process.env.REGISTRY_TOKEN ?? "";
const HEALTH_URL = process.env.HEALTH_URL ?? "";

async function api(method, path, body) {
  const res = await fetch(`${ARCANE_URL}/api${path}`, {
    method,
    headers: { "X-API-Key": API_KEY, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return text;
}
const json = async (method, path, body) => JSON.parse((await api(method, path, body)) || "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Only for a private image: add a ghcr.io pull credential if Arcane has none.
//    An existing entry is never overwritten, since other projects may rely on it.
if (REGISTRY_USER && REGISTRY_TOKEN) {
  const list = await json("GET", "/registries?search=ghcr.io&limit=50");
  const existing = (list.data ?? []).find((r) => /(^|\/\/)ghcr\.io/.test(r.url ?? r.host ?? ""));
  if (existing) console.log("Arcane already has a ghcr.io credential; leaving it unchanged");
  else {
    await api("POST", "/registries", { url: "ghcr.io", username: REGISTRY_USER, token: REGISTRY_TOKEN, enabled: true, description: "GitHub Container Registry" });
    console.log(`ghcr.io credential created for ${REGISTRY_USER}`);
  }
}

// 2. Pin the image in the project's compose file.
const compose = readFileSync("deploy/compose.yml", "utf8");
const pinned = compose.replace(/ghcr\.io\/edbourque0\/zfstack:[\w.-]+/g, IMAGE);
if (pinned === compose && !compose.includes(IMAGE)) throw new Error("Image reference not found in deploy/compose.yml");
await api("PATCH", `/agents/${ENV_ID}/projects/${PROJECT_ID}`, { composeContent: pinned });
console.log(`Compose updated to ${IMAGE}`);

// 3. Redeploy (pull + down + up). The endpoint streams progress lines.
const out = await api("POST", `/agents/${ENV_ID}/projects/${PROJECT_ID}/deploy?action=redeploy`, { pullPolicy: "always", removeOrphans: true });
const lines = out.split("\n").filter(Boolean);
for (const l of lines.slice(-15)) console.log(`  ${l.slice(0, 300)}`);
const failed = lines.find((l) => /"(type|status|level)"\s*:\s*"error"|"error"\s*:\s*"[^"]/i.test(l));
if (failed) throw new Error(`Arcane reported an error: ${failed.slice(0, 500)}`);

// 4. Wait for the project to run and, if given, for the health endpoint.
for (let i = 0; i < 30; i++) {
  const p = await json("GET", `/agents/${ENV_ID}/projects/${PROJECT_ID}`);
  const d = p.data ?? p;
  if (d.status === "running" && d.runningCount >= d.serviceCount) {
    console.log(`Project ${d.name} running (${d.runningCount}/${d.serviceCount})`);
    break;
  }
  if (i === 29) throw new Error(`Project did not start: ${d.status} ${d.statusReason ?? ""}`);
  await sleep(4000);
}
if (HEALTH_URL) {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(HEALTH_URL);
      if (r.ok) { console.log(`Health check passed: ${HEALTH_URL}`); process.exit(0); }
    } catch { /* not up yet */ }
    await sleep(3000);
  }
  throw new Error(`Health check failed: ${HEALTH_URL}`);
}
