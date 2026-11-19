/**
 * TrueNAS import: reads a TrueNAS SCALE / CORE instance with an API key and
 * turns its pools, vdev topology, disks, shares and apps into ZFStack records.
 *
 * Transport: JSON-RPC 2.0 over WebSocket at /api/current (TrueNAS 25.04+),
 * falling back to the REST API at /api/v2.0 (older releases).
 */
import http from "node:http";
import https from "node:https";
import WebSocket from "ws";
import type { PoolClient } from "pg";
import { HttpError } from "./entities.js";
import { zfsState } from "./zpool.js";

export interface ConnOptions {
  url: string;
  api_key: string;
  insecure_tls?: boolean;
  allow_http?: boolean;
}

interface Conn {
  transport: "websocket" | "rest";
  call(method: string, params?: unknown[]): Promise<any>;
  close(): void;
}

const TIMEOUT = 20000;

/** Path prefix of the TrueNAS URL without a trailing slash ("" for the root). */
const prefix = (u: URL) => u.pathname.replace(/\/+$/, "");

export function normalizeUrl(raw: string, allowHttp = false): URL {
  const s = (raw ?? "").trim();
  if (!s) throw new HttpError(400, "Enter the TrueNAS address.");
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new HttpError(400, "That address is not a valid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "Use an https:// address.");
  if (u.protocol === "http:" && !allowHttp)
    throw new HttpError(400, "TrueNAS revokes API keys sent over plain HTTP. Use https://, or allow HTTP explicitly if your version does not.");
  u.hash = "";
  u.search = "";
  return u;
}

/* ---------- WebSocket JSON-RPC ---------- */

function connectWs(base: URL, key: string, insecure: boolean): Promise<Conn> {
  const wsUrl = new URL(base.toString());
  wsUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = `${prefix(base)}/api/current`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { rejectUnauthorized: !insecure, handshakeTimeout: TIMEOUT });
    let seq = 0;
    const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void; t: NodeJS.Timeout }>();
    const fail = (e: Error) => {
      for (const p of pending.values()) { clearTimeout(p.t); p.rej(e); }
      pending.clear();
    };
    const call = (method: string, params: unknown[] = []) =>
      new Promise<any>((res, rej) => {
        const id = ++seq;
        const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, TIMEOUT);
        pending.set(id, { res, rej, t });
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      });
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.t);
      if (msg.error) p.rej(new Error(msg.error.data?.reason ?? msg.error.message ?? "TrueNAS returned an error"));
      else p.res(msg.result);
    });
    ws.on("error", (e) => { fail(e); reject(e); });
    ws.on("close", () => fail(new Error("Connection closed")));
    ws.on("open", async () => {
      try {
        const ok = await call("auth.login_with_api_key", [key]);
        if (ok !== true) throw new HttpError(401, "TrueNAS rejected the API key.");
        resolve({ transport: "websocket", call, close: () => ws.close() });
      } catch (e) {
        ws.close();
        reject(e);
      }
    });
  });
}

/* ---------- REST v2.0 fallback ---------- */

const REST: Record<string, (params: any[]) => { method: "GET" | "POST"; path: string; body?: unknown }> = {
  "system.info": () => ({ method: "GET", path: "/system/info" }),
  "pool.query": () => ({ method: "GET", path: "/pool" }),
  "disk.query": () => ({ method: "GET", path: "/disk?limit=0" }),
  "disk.temperatures": () => ({ method: "POST", path: "/disk/temperatures", body: { names: [] } }),
  "pool.dataset.get_instance": ([id]) => ({ method: "GET", path: `/pool/dataset/id/${encodeURIComponent(id)}` }),
  "sharing.smb.query": () => ({ method: "GET", path: "/sharing/smb" }),
  "sharing.nfs.query": () => ({ method: "GET", path: "/sharing/nfs" }),
  "app.query": () => ({ method: "GET", path: "/app" }),
  "docker.config": () => ({ method: "GET", path: "/docker" }),
};

function restRequest(base: URL, key: string, insecure: boolean, method: string, path: string, body?: unknown): Promise<any> {
  const url = new URL(`${base.origin}${prefix(base)}/api/v2.0${path}`);
  const lib = url.protocol === "https:" ? https : http;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
        rejectUnauthorized: !insecure,
        timeout: TIMEOUT,
      } as https.RequestOptions,
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode === 401 || res.statusCode === 403) return reject(new HttpError(401, "TrueNAS rejected the API key."));
          if (!res.statusCode || res.statusCode >= 400) return reject(new Error(`TrueNAS answered ${res.statusCode} for ${path}`));
          try { resolve(data ? JSON.parse(data) : null); } catch { reject(new Error(`TrueNAS sent invalid JSON for ${path}`)); }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${path} timed out`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function connectRest(base: URL, key: string, insecure: boolean): Conn {
  return {
    transport: "rest",
    call: (method, params = []) => {
      const m = REST[method];
      if (!m) return Promise.reject(new Error(`${method} is not available over REST`));
      const r = m(params);
      return restRequest(base, key, insecure, r.method, r.path, r.body);
    },
    close: () => {},
  };
}

function friendly(err: any): HttpError {
  if (err instanceof HttpError) return err;
  const code = err?.code ?? err?.cause?.code;
  if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "ERR_TLS_CERT_ALTNAME_INVALID")
    return new HttpError(502, "TrueNAS uses a certificate this server does not trust. Tick “Accept self-signed certificate” to continue.");
  if (code === "ECONNREFUSED") return new HttpError(502, "TrueNAS refused the connection. Check the address and port.");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new HttpError(502, "That host name does not resolve from the ZFStack server.");
  if (code === "ETIMEDOUT" || /timed out/.test(err?.message ?? "")) return new HttpError(504, "TrueNAS did not answer in time.");
  return new HttpError(502, `Could not read TrueNAS: ${err?.message ?? "unknown error"}`);
}

async function connect(o: ConnOptions): Promise<Conn> {
  if (!o.api_key?.trim()) throw new HttpError(400, "Enter an API key.");
  const base = normalizeUrl(o.url, o.allow_http);
  const insecure = !!o.insecure_tls;
  try {
    return await connectWs(base, o.api_key.trim(), insecure);
  } catch (wsErr: any) {
    if (wsErr instanceof HttpError) throw wsErr;
    const rest = connectRest(base, o.api_key.trim(), insecure);
    try {
      await rest.call("system.info");
      return rest;
    } catch (restErr: any) {
      // Report the most useful of the two failures.
      const tls = [wsErr, restErr].find((e) => /CERT|SELF_SIGNED|VERIFY/.test(String(e?.code ?? e?.cause?.code ?? "")));
      throw friendly(tls ?? (restErr instanceof HttpError ? restErr : wsErr));
    }
  }
}

/* ---------- snapshot ---------- */

export interface Snapshot {
  transport: "websocket" | "rest";
  info: any;
  pools: any[];
  disks: any[];
  datasets: Record<string, any>;
  temps: Record<string, number | null>;
  smb: any[];
  nfs: any[];
  apps: any[];
  appsPool: string | null;
  warnings: string[];
}

export async function fetchSnapshot(o: ConnOptions): Promise<Snapshot> {
  const conn = await connect(o);
  const warnings: string[] = [];
  const optional = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); } catch { warnings.push(`Could not read ${label}.`); return fallback; }
  };
  try {
    const info = await conn.call("system.info");
    const pools: any[] = (await conn.call("pool.query")) ?? [];
    const disks: any[] = (await conn.call("disk.query")) ?? [];
    const datasets: Record<string, any> = {};
    for (const p of pools) {
      datasets[p.name] = await optional(`dataset ${p.name}`, () => conn.call("pool.dataset.get_instance", [p.name]), null);
    }
    const temps = await optional("disk temperatures", async () => {
      const t = conn.transport === "websocket"
        ? await conn.call("disk.temperatures", [disks.map((d) => d.name)]).catch(() => conn.call("disk.temperatures"))
        : await conn.call("disk.temperatures");
      return (t ?? {}) as Record<string, number | null>;
    }, {});
    const smb = await optional("SMB shares", () => conn.call("sharing.smb.query"), []);
    const nfs = await optional("NFS shares", () => conn.call("sharing.nfs.query"), []);
    const apps = await optional("apps", () => conn.call("app.query"), []);
    const docker = await optional("the apps pool", () => conn.call("docker.config"), null as any);
    return {
      transport: conn.transport, info, pools, disks, datasets, temps,
      smb: smb ?? [], nfs: nfs ?? [], apps: apps ?? [], appsPool: docker?.pool ?? null, warnings,
    };
  } catch (e) {
    throw friendly(e);
  } finally {
    conn.close();
  }
}

/* ---------- planning (pure) ---------- */

export interface Existing {
  servers: any[];
  pools: any[];
  disks: any[];
  services: any[];
  service_pools: any[];
}

export interface ImportOptions {
  server_id?: number | null;
  include_unused?: boolean;
  include_shares?: boolean;
  include_apps?: boolean;
}

type Role = "data" | "spare" | "log" | "special" | "cache" | "dedup";
export interface DiskOp { id: number | null; serial: string; pool: string | null; data: Record<string, unknown> }
export interface PoolOp { id: number | null; name: string; data: Record<string, unknown>; vdevs: number; disks: number; missing: number }
export interface ServiceOp { id: number | null; name: string; data: Record<string, unknown>; maps: { pool: string; dataset: string; access: "rw" | "ro" }[] }
export interface Plan {
  transport: string;
  version: string;
  server: { id: number | null; name: string; data: Record<string, unknown> };
  pools: PoolOp[];
  disks: DiskOp[];
  unlink: { id: number; serial: string; pool: string }[];
  services: ServiceOp[];
  warnings: string[];
}

const SECTIONS: [string, Role][] = [["data", "data"], ["special", "special"], ["dedup", "dedup"], ["log", "log"], ["cache", "cache"], ["spare", "spare"], ["spares", "spare"]];

function leaves(v: any): any[] {
  const kids = Array.isArray(v?.children) ? v.children : [];
  return kids.length ? kids.flatMap(leaves) : [v];
}

function layoutOf(type: string | undefined): string {
  const t = (type ?? "").toLowerCase();
  if (t.startsWith("mirror")) return "mirror";
  const rz = t.match(/^raidz([123])?/);
  if (rz) return `raidz${rz[1] ?? "1"}`;
  const dr = t.match(/^draid([123])?/);
  if (dr) return `draid${dr[1] ?? "1"}`;
  return "stripe";
}

const POOL_STATUS: Record<string, string> = { ONLINE: "online", DEGRADED: "degraded", FAULTED: "faulted", UNAVAIL: "faulted", OFFLINE: "offline", REMOVED: "faulted", SUSPENDED: "faulted" };

function epochDate(v: any): string | null {
  const ms = typeof v === "number" ? v : typeof v?.$date === "number" ? v.$date : null;
  if (ms === null) return null;
  return new Date(ms > 1e12 ? ms : ms * 1000).toISOString().slice(0, 10);
}

function poolFromPath(path: string | undefined, appsPool: string | null): { pool: string; dataset: string } | null {
  if (!path) return null;
  if (path.startsWith("/mnt/.ix-apps")) return appsPool ? { pool: appsPool, dataset: `${appsPool}/ix-apps` } : null;
  const m = path.match(/^\/mnt\/([^/]+)(\/.*)?$/);
  return m ? { pool: m[1], dataset: `${m[1]}${m[2] ?? ""}` } : null;
}

const prop = (ds: any, k: string) => {
  const v = ds?.[k];
  if (v === undefined || v === null) return null;
  return typeof v === "object" ? v.value ?? v.rawvalue ?? null : v;
};

export function planImport(snap: Snapshot, ex: Existing, opts: ImportOptions): Plan {
  const info = snap.info ?? {};
  const hostname: string = info.hostname ?? "truenas";
  const warnings = [...snap.warnings];

  // Server: chosen one, else match on hostname, else create.
  const chosen = opts.server_id ? ex.servers.find((s) => s.id === opts.server_id) : undefined;
  const matched = chosen ?? ex.servers.find((s) => [s.hostname, s.name].some((x) => x && x.split(".")[0].toLowerCase() === hostname.split(".")[0].toLowerCase()));
  const ramGb = info.physmem ? Math.round(info.physmem / 1024 ** 3) : null;
  const serverData: Record<string, unknown> = {
    hostname,
    os: info.version ? (String(info.version).startsWith("TrueNAS") ? info.version : `TrueNAS ${info.version}`) : null,
    cpu: info.model ?? null,
    ram_gb: ramGb,
  };
  if (!matched || !matched.vendor) serverData.vendor = info.system_manufacturer || null;
  if (!matched || !matched.model) serverData.model = info.system_product || null;
  if (!matched || !matched.serial) serverData.serial = info.system_serial || null;
  if (!matched) Object.assign(serverData, { name: hostname.split(".")[0], kind: "nas", status: "active", bay_count: 0 });

  const diskByName = new Map<string, any>(snap.disks.map((d) => [d.name, d]));
  const existingBySerial = new Map<string, any>(ex.disks.map((d) => [String(d.serial).toLowerCase(), d]));
  const serverPools = ex.pools.filter((p) => matched && p.server_id === matched.id);

  const diskOps = new Map<string, DiskOp>();
  const hwFields = (d: any, current: any) => {
    const name: string = d.name ?? "";
    const media = name.startsWith("nvme") ? "nvme" : String(d.type ?? "").toUpperCase() === "SSD" ? "ssd" : "hdd";
    const bus = String(d.bus ?? d.subsystem ?? "").toUpperCase();
    const out: Record<string, unknown> = {
      model: d.model || current?.model || null,
      capacity_gb: d.size ? Math.round(d.size / 1e8) / 10 : current?.capacity_gb ?? 1,
      media,
      rpm: d.rotationrate ?? (media === "hdd" ? current?.rpm ?? null : null),
      temperature_c: snap.temps?.[name] ?? current?.temperature_c ?? null,
    };
    if (!current) {
      out.interface = media === "nvme" || bus.includes("NVME") ? "nvme" : bus.includes("USB") ? "usb" : "sata";
      out.form_factor = media === "nvme" ? "m.2" : "3.5";
      out.wwn = d.lunid ? String(d.lunid) : null;
      out.notes = `Imported from TrueNAS ${hostname} as ${name}. Place it in a bay in the rack view.`;
    }
    return out;
  };
  const serialOf = (d: any) => String(d.serial || d.identifier || d.name || "").trim();

  const pools: PoolOp[] = snap.pools.map((p) => {
    const topo = p.topology ?? {};
    let vdevs = 0, count = 0, missing = 0;
    let layout: string | null = null;
    for (const [section, role] of SECTIONS) {
      const list: any[] = Array.isArray(topo[section]) ? topo[section] : [];
      list.forEach((v, idx) => {
        const isGroup = Array.isArray(v.children) && v.children.length > 0;
        const vdevName = isGroup ? (v.name && !/^\d+$/.test(v.name) ? v.name : `${String(v.type).toLowerCase()}-${idx}`) : null;
        if (role === "data") {
          vdevs++;
          layout ??= isGroup ? layoutOf(v.type) : "stripe";
        }
        for (const leaf of leaves(v)) {
          const dname = leaf.disk ?? (leaf.device ? String(leaf.device).replace(/p?\d+$/, "") : null);
          const d = dname ? diskByName.get(dname) : undefined;
          if (!d) { missing++; continue; }
          const serial = serialOf(d);
          if (!serial) { missing++; continue; }
          count++;
          const current = existingBySerial.get(serial.toLowerCase());
          const status = zfsState(leaf.status ?? "ONLINE");
          diskOps.set(serial.toLowerCase(), {
            id: current?.id ?? null, serial, pool: p.name,
            data: { ...hwFields(d, current), vdev: vdevName, role, status: role === "spare" && status === "available" ? "available" : status },
          });
        }
      });
    }
    if (missing) warnings.push(`${p.name}: ${missing} device${missing === 1 ? "" : "s"} could not be matched to a disk (missing or removed).`);
    const ds = snap.datasets?.[p.name];
    const used = ds?.used?.parsed ?? (typeof ds?.used === "number" ? ds.used : null) ?? p.allocated ?? null;
    const scan = p.scan ?? {};
    const scrub = String(scan.function ?? "").toUpperCase() === "SCRUB" && String(scan.state ?? "").toUpperCase() === "FINISHED" ? epochDate(scan.end_time) : null;
    const existing = serverPools.find((x) => x.name === p.name);
    const data: Record<string, unknown> = {
      layout: layout ?? "stripe",
      status: POOL_STATUS[String(p.status ?? "").toUpperCase()] ?? (p.healthy === false ? "degraded" : "online"),
      used_gb: used !== null ? Math.round(Number(used) / 1e8) / 10 : null,
    };
    if (scrub) data.last_scrub = scrub;
    const comp = prop(ds, "compression");
    if (comp) data.compression = String(comp).toLowerCase();
    const rs = prop(ds, "recordsize");
    if (rs) data.recordsize = String(rs).toUpperCase();
    if (ds && typeof ds.encrypted === "boolean") data.encryption = ds.encrypted;
    const dd = prop(ds, "deduplication");
    if (dd) data.dedup = String(dd).toUpperCase() !== "OFF";
    if (!existing) data.purpose = `Imported from TrueNAS ${hostname}.`;
    return { id: existing?.id ?? null, name: p.name, data, vdevs, disks: count, missing };
  });

  // Disks known to TrueNAS but in no pool.
  if (opts.include_unused !== false) {
    for (const d of snap.disks) {
      const serial = serialOf(d);
      if (!serial || diskOps.has(serial.toLowerCase())) continue;
      const current = existingBySerial.get(serial.toLowerCase());
      if (current?.pool_id && !serverPools.some((p) => p.id === current.pool_id)) continue; // belongs to another host's pool
      diskOps.set(serial.toLowerCase(), {
        id: current?.id ?? null, serial, pool: null,
        data: { ...hwFields(d, current), ...(current && current.status !== "available" && current.pool_id ? { vdev: null, role: "data", status: "available" } : current ? {} : { status: "available", role: "data" }) },
      });
    }
  }

  // Disks ZFStack still lists in these pools that TrueNAS no longer reports.
  const importedNames = new Set(pools.map((p) => p.name));
  const unlink = ex.disks
    .filter((d) => d.pool_id && serverPools.some((p) => p.id === d.pool_id && importedNames.has(p.name)) && !diskOps.has(String(d.serial).toLowerCase()))
    .map((d) => ({ id: d.id, serial: d.serial, pool: serverPools.find((p) => p.id === d.pool_id)!.name }));

  // Services from shares and apps.
  const services: ServiceOp[] = [];
  const findSvc = (name: string, kind: string) =>
    ex.services.find((s) => s.name === name && s.kind === kind && (!matched || s.server_id === matched.id || s.server_id === null));
  const poolNames = new Set(snap.pools.map((p) => p.name));
  if (opts.include_shares !== false) {
    for (const s of snap.smb) {
      const loc = poolFromPath(s.path, snap.appsPool);
      const name = `SMB · ${s.name ?? s.path}`;
      services.push({
        id: findSvc(name, "share")?.id ?? null, name,
        data: { kind: "share", status: s.enabled === false ? "stopped" : "running", description: s.comment || `SMB share of ${s.path}` },
        maps: loc && poolNames.has(loc.pool) ? [{ pool: loc.pool, dataset: loc.dataset, access: s.ro ? "ro" : "rw" }] : [],
      });
    }
    for (const s of snap.nfs) {
      const paths: string[] = s.path ? [s.path] : Array.isArray(s.paths) ? s.paths : [];
      if (!paths.length) continue;
      const name = `NFS · ${paths[0]}`;
      services.push({
        id: findSvc(name, "share")?.id ?? null, name,
        data: { kind: "share", status: s.enabled === false ? "stopped" : "running", description: s.comment || `NFS export of ${paths.join(", ")}` },
        maps: paths.map((x) => poolFromPath(x, snap.appsPool)).filter((l): l is { pool: string; dataset: string } => !!l && poolNames.has(l.pool))
          .map((l) => ({ pool: l.pool, dataset: l.dataset, access: s.ro ? "ro" : "rw" })),
      });
    }
  }
  if (opts.include_apps !== false) {
    for (const a of snap.apps) {
      const vols: any[] = a.active_workloads?.volumes ?? [];
      const seen = new Set<string>();
      const maps: ServiceOp["maps"] = [];
      for (const v of vols) {
        const loc = poolFromPath(v.source, snap.appsPool);
        if (!loc || !poolNames.has(loc.pool) || seen.has(loc.dataset)) continue;
        seen.add(loc.dataset);
        maps.push({ pool: loc.pool, dataset: loc.dataset, access: "rw" });
      }
      if (!maps.length && snap.appsPool && poolNames.has(snap.appsPool)) maps.push({ pool: snap.appsPool, dataset: `${snap.appsPool}/ix-apps`, access: "rw" });
      const name = a.name ?? a.id;
      if (!name) continue;
      const state = String(a.state ?? "").toUpperCase();
      services.push({
        id: findSvc(name, "docker")?.id ?? null, name,
        data: { kind: "docker", status: state === "STOPPED" ? "stopped" : "running", description: a.metadata?.title ? `${a.metadata.title} app on TrueNAS` : "TrueNAS app" },
        maps,
      });
    }
  }

  return {
    transport: snap.transport,
    version: String(info.version ?? "unknown"),
    server: { id: matched?.id ?? null, name: matched?.name ?? String(serverData.name), data: serverData },
    pools,
    disks: [...diskOps.values()],
    unlink,
    services,
    warnings,
  };
}

/* ---------- apply ---------- */


async function upsert(c: PoolClient, table: string, id: number | null, data: Record<string, unknown>): Promise<number> {
  const cols = Object.keys(data);
  if (id) {
    if (cols.length)
      await c.query(`UPDATE ${table} SET ${cols.map((k, i) => `${k}=$${i + 1}`).join(",")}, updated_at=now() WHERE id=$${cols.length + 1}`, [...cols.map((k) => data[k]), id]);
    return id;
  }
  const { rows } = await c.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, cols.map((k) => data[k]));
  return rows[0].id;
}

export async function applyPlan(c: PoolClient, plan: Plan) {
  const serverId = await upsert(c, "servers", plan.server.id, plan.server.data);
  const poolIds = new Map<string, number>();
  for (const p of plan.pools) poolIds.set(p.name, await upsert(c, "pools", p.id, { ...p.data, ...(p.id ? {} : { name: p.name, server_id: serverId }) }));
  for (const u of plan.unlink) {
    await c.query("UPDATE disks SET pool_id=NULL, vdev=NULL, role='data', status='available', updated_at=now() WHERE id=$1", [u.id]);
  }
  for (const d of plan.disks) {
    const data: Record<string, unknown> = { ...d.data };
    if (d.pool) data.pool_id = poolIds.get(d.pool) ?? null;
    else if (d.id && "status" in data && data.status === "available") data.pool_id = null;
    if (!d.id) data.serial = d.serial;
    await upsert(c, "disks", d.id, data);
  }
  let maps = 0;
  for (const s of plan.services) {
    const sid = await upsert(c, "services", s.id, { ...s.data, ...(s.id ? {} : { name: s.name, server_id: serverId, criticality: "medium" }) });
    for (const m of s.maps) {
      const pid = poolIds.get(m.pool);
      if (!pid) continue;
      const { rows } = await c.query("SELECT id FROM service_pools WHERE service_id=$1 AND pool_id=$2 AND COALESCE(dataset,'')=$3", [sid, pid, m.dataset]);
      if (!rows.length) {
        await c.query("INSERT INTO service_pools(service_id, pool_id, dataset, access) VALUES ($1,$2,$3,$4)", [sid, pid, m.dataset, m.access]);
        maps++;
      }
    }
  }
  const created = plan.disks.filter((d) => !d.id).length;
  await c.query("INSERT INTO events(kind, title, body, server_id) VALUES ('note',$1,$2,$3)", [
    `Synced from TrueNAS ${plan.server.name}`,
    `${plan.pools.length} pools, ${plan.disks.length} disks (${created} new), ${plan.services.length} services. TrueNAS ${plan.version}.${plan.unlink.length ? ` ${plan.unlink.length} disks left their pool: ${plan.unlink.map((u) => u.serial).join(", ")}.` : ""}`,
    serverId,
  ]);
  return { server_id: serverId, pools: plan.pools.length, disks: plan.disks.length, created, unlinked: plan.unlink.length, services: plan.services.length, mappings: maps };
}
