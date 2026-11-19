import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, pool, tx } from "./db.js";
import {
  ENTITIES, HttpError, clean, deleteRow, getEntity, insertRow, listAll, pgError, updateRow,
} from "./entities.js";
import { matchSerial, parseZpoolStatus, serialFromById, zfsState, type ParsedPool } from "./zpool.js";
import { applyPlan, fetchSnapshot, planImport, type ConnOptions, type ImportOptions } from "./truenas.js";

/** Settings returned to browsers and backups never include stored secrets. */
function publicSettings(rows: { key: string; value: any }[]) {
  return Object.fromEntries(
    rows.map((r) => {
      if (r.key === "truenas" && r.value && typeof r.value === "object") {
        const { api_key, ...rest } = r.value;
        return [r.key, { ...rest, has_key: !!api_key }];
      }
      return [r.key, r.value];
    }),
  );
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 20 * 1024 * 1024 });

app.setErrorHandler((err: any, _req, reply) => {
  const mapped = err instanceof HttpError ? err : pgError(err);
  if (mapped) return reply.status(mapped.status).send({ error: mapped.message });
  if (err.validation || err.statusCode === 400) return reply.status(400).send({ error: err.message });
  app.log.error(err);
  return reply.status(500).send({ error: "Something went wrong on the server." });
});

const idParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Invalid id");
  return n;
};
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- health & state ---------- */

app.get("/api/health", async () => {
  await pool.query("SELECT 1");
  return { ok: true };
});

app.get("/api/state", async () => {
  const out: Record<string, unknown> = {};
  for (const [name, e] of Object.entries(ENTITIES)) out[name] = await listAll(pool, e);
  const { rows } = await pool.query("SELECT key, value FROM settings");
  out.settings = publicSettings(rows);
  return out;
});

app.put<{ Params: { key: string }; Body: { value: unknown } }>("/api/settings/:key", async (req) => {
  if (!/^[a-z0-9_.-]{1,64}$/i.test(req.params.key)) throw new HttpError(400, "Invalid key");
  if (req.params.key === "truenas") throw new HttpError(400, "Use the TrueNAS import to change this setting.");
  await pool.query(
    "INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [req.params.key, JSON.stringify(req.body?.value ?? null)],
  );
  return { ok: true };
});

/* ---------- disk actions ---------- */

app.post<{ Body: { template: Record<string, unknown>; serials: string[]; start_bay?: number | null } }>(
  "/api/disks/bulk",
  async (req) => {
    const { template, serials, start_bay } = req.body ?? ({} as any);
    const list = (serials ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!list.length) throw new HttpError(400, "Add at least one serial number.");
    if (new Set(list).size !== list.length) throw new HttpError(400, "Serial numbers must be unique.");
    const e = ENTITIES.disks;
    return tx(async (c) => {
      const created = [];
      for (let i = 0; i < list.length; i++) {
        const row = clean(e, { ...template, serial: list[i] }, false);
        if (start_bay !== null && start_bay !== undefined && row.server_id) row.bay = Number(start_bay) + i;
        created.push(await insertRow(c, e, row));
      }
      return created;
    });
  },
);

app.post<{ Params: { id: string }; Body: { server_id: number | null; bay: number | null } }>(
  "/api/disks/:id/move",
  async (req) => {
    const id = idParam(req.params.id);
    const server_id = req.body?.server_id ?? null;
    const bay = req.body?.bay ?? null;
    return tx(async (c) => {
      const { rows: [disk] } = await c.query("SELECT * FROM disks WHERE id=$1 FOR UPDATE", [id]);
      if (!disk) throw new HttpError(404, "Disk not found");
      if (server_id !== null && bay !== null) {
        const { rows: [srv] } = await c.query("SELECT bay_count, name FROM servers WHERE id=$1", [server_id]);
        if (!srv) throw new HttpError(404, "Server not found");
        if (bay < 0 || bay >= srv.bay_count) throw new HttpError(400, `${srv.name} has bays 0 to ${srv.bay_count - 1}.`);
      }
      let swapped = null;
      if (server_id !== null && bay !== null) {
        const { rows: [other] } = await c.query(
          "SELECT * FROM disks WHERE server_id=$1 AND bay=$2 AND id<>$3 FOR UPDATE",
          [server_id, bay, id],
        );
        if (other) {
          // Swap: park the moving disk, move the other into its old slot.
          await c.query("UPDATE disks SET bay=NULL WHERE id=$1", [id]);
          await c.query("UPDATE disks SET server_id=$1, bay=$2, updated_at=now() WHERE id=$3", [
            disk.server_id, disk.server_id === null ? null : disk.bay, other.id,
          ]);
          swapped = other.id;
        }
      }
      const { rows: [moved] } = await c.query(
        "UPDATE disks SET server_id=$1, bay=$2, updated_at=now() WHERE id=$3 RETURNING *",
        [server_id, server_id === null ? null : bay, id],
      );
      return { disk: moved, swapped };
    });
  },
);

app.post<{ Params: { id: string }; Body: { replacement_id: number; old_status?: string; note?: string } }>(
  "/api/disks/:id/replace",
  async (req) => {
    const id = idParam(req.params.id);
    const repl = idParam(String(req.body?.replacement_id));
    const oldStatus = req.body?.old_status === "retired" ? "retired" : "failed";
    if (id === repl) throw new HttpError(400, "Pick a different disk as the replacement.");
    return tx(async (c) => {
      const { rows: [old] } = await c.query("SELECT * FROM disks WHERE id=$1 FOR UPDATE", [id]);
      const { rows: [neu] } = await c.query("SELECT * FROM disks WHERE id=$1 FOR UPDATE", [repl]);
      if (!old || !neu) throw new HttpError(404, "Disk not found");
      if (neu.pool_id) throw new HttpError(400, "The replacement already belongs to a pool.");
      // The new disk physically takes the old disk's bay and its place in the pool.
      await c.query("UPDATE disks SET server_id=NULL, bay=NULL, pool_id=NULL, vdev=NULL, status=$2, updated_at=now() WHERE id=$1", [id, oldStatus]);
      await c.query("UPDATE disks SET bay=NULL WHERE id=$1", [repl]);
      const { rows: [updated] } = await c.query(
        `UPDATE disks SET server_id=$1, bay=$2, pool_id=$3, vdev=$4, role=$5, status='online', updated_at=now()
         WHERE id=$6 RETURNING *`,
        [old.server_id, old.bay, old.pool_id, old.vdev, old.role, repl],
      );
      let poolName = null;
      if (old.pool_id) {
        const { rows: [p] } = await c.query("SELECT name FROM pools WHERE id=$1", [old.pool_id]);
        poolName = p?.name;
      }
      await c.query(
        "INSERT INTO events(kind, title, body, disk_id, pool_id, server_id) VALUES ('replace',$1,$2,$3,$4,$5)",
        [
          `Replaced ${old.serial} with ${neu.serial}${poolName ? ` in ${poolName}` : ""}`,
          req.body?.note || `Old disk marked ${oldStatus}. Resilver with: zpool replace ${poolName ?? "<pool>"} ${old.serial} ${neu.serial}`,
          repl, old.pool_id, old.server_id,
        ],
      );
      return updated;
    });
  },
);

/* ---------- pool actions ---------- */

app.post<{ Params: { id: string }; Body: { date?: string; note?: string } }>("/api/pools/:id/scrubbed", async (req) => {
  const id = idParam(req.params.id);
  const date = req.body?.date || today();
  return tx(async (c) => {
    const { rows: [p] } = await c.query(
      "UPDATE pools SET last_scrub=$1, updated_at=now() WHERE id=$2 RETURNING *",
      [date, id],
    );
    if (!p) throw new HttpError(404, "Pool not found");
    await c.query("INSERT INTO events(kind, at, title, body, pool_id, server_id) VALUES ('scrub',$1,$2,$3,$4,$5)", [
      date, `Scrub of ${p.name} finished`, req.body?.note || null, p.id, p.server_id,
    ]);
    return p;
  });
});

/* ---------- zpool status import ---------- */

interface PlanDevice {
  device: string;
  serial: string;
  disk_id: number | null;
  action: "link" | "create";
  vdev: string | null;
  role: string;
  status: string;
}
interface PlanPool {
  name: string;
  layout: string;
  state: string;
  last_scrub: string | null;
  pool_id: number | null;
  action: "update" | "create";
  devices: PlanDevice[];
}

async function buildPlan(text: string, serverId: number): Promise<PlanPool[]> {
  const parsed: ParsedPool[] = parseZpoolStatus(text ?? "");
  if (!parsed.length) throw new HttpError(400, "No pools found. Paste the full output of zpool status.");
  const { rows: disks } = await pool.query("SELECT id, serial, wwn FROM disks");
  const { rows: pools } = await pool.query("SELECT id, name FROM pools WHERE server_id=$1", [serverId]);
  const serials = disks.map((d) => d.serial as string);
  const wwns = disks.filter((d) => d.wwn).map((d) => d.wwn as string);
  return parsed.map((p) => {
    const existing = pools.find((x) => x.name === p.name);
    return {
      name: p.name,
      layout: p.layout,
      state: p.state,
      last_scrub: p.lastScrub,
      pool_id: existing?.id ?? null,
      action: existing ? "update" : "create",
      devices: p.devices.map((d) => {
        const hit = matchSerial(d.name, serials) ?? null;
        const wwnHit = !hit ? matchSerial(d.name, wwns) : null;
        const disk = hit
          ? disks.find((x) => x.serial === hit)
          : wwnHit
            ? disks.find((x) => x.wwn === wwnHit)
            : undefined;
        return {
          device: d.name,
          serial: disk?.serial ?? serialFromById(d.name),
          disk_id: disk?.id ?? null,
          action: disk ? "link" : "create",
          vdev: d.vdev,
          role: d.role,
          status: zfsState(d.state),
        } satisfies PlanDevice;
      }),
    } satisfies PlanPool;
  });
}

const POOL_STATE: Record<string, string> = { ONLINE: "online", DEGRADED: "degraded", FAULTED: "faulted", OFFLINE: "offline", UNAVAIL: "faulted", SUSPENDED: "faulted" };

app.post<{ Body: { text: string; server_id: number } }>("/api/zpool/preview", async (req) => {
  const serverId = idParam(String(req.body?.server_id));
  return buildPlan(req.body.text, serverId);
});

app.post<{ Body: { text: string; server_id: number; capacity_gb?: number } }>("/api/zpool/apply", async (req) => {
  const serverId = idParam(String(req.body?.server_id));
  const plan = await buildPlan(req.body.text, serverId);
  const capacity = Number(req.body.capacity_gb) > 0 ? Number(req.body.capacity_gb) : 1000;
  return tx(async (c) => {
    let pools = 0, linked = 0, created = 0;
    for (const p of plan) {
      const layout = ["stripe", "mirror", "raidz1", "raidz2", "raidz3", "draid1", "draid2", "draid3"].includes(p.layout) ? p.layout : "stripe";
      const status = POOL_STATE[p.state.toUpperCase()] ?? "online";
      let poolId = p.pool_id;
      if (poolId) {
        await c.query("UPDATE pools SET layout=$1, status=$2, last_scrub=COALESCE($3, last_scrub), updated_at=now() WHERE id=$4", [layout, status, p.last_scrub, poolId]);
      } else {
        const { rows: [np] } = await c.query(
          "INSERT INTO pools(name, server_id, layout, status, last_scrub) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [p.name, serverId, layout, status, p.last_scrub],
        );
        poolId = np.id;
      }
      pools++;
      for (const d of p.devices) {
        const status = d.role === "spare" && d.status === "available" ? "available" : d.status;
        if (d.disk_id) {
          await c.query("UPDATE disks SET pool_id=$1, vdev=$2, role=$3, status=$4, updated_at=now() WHERE id=$5", [poolId, d.vdev, d.role, status, d.disk_id]);
          linked++;
        } else {
          await c.query(
            "INSERT INTO disks(serial, capacity_gb, pool_id, vdev, role, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (serial) DO UPDATE SET pool_id=EXCLUDED.pool_id, vdev=EXCLUDED.vdev, role=EXCLUDED.role, status=EXCLUDED.status",
            [d.serial, capacity, poolId, d.vdev, d.role, status, `Imported from zpool status as ${d.device}. Check its size and place it in a bay.`],
          );
          created++;
        }
      }
      await c.query("INSERT INTO events(kind, title, body, pool_id, server_id) VALUES ('note',$1,$2,$3,$4)", [
        `Imported ${p.name} from zpool status`, `${p.devices.length} devices, layout ${layout}, state ${p.state}.`, poolId, serverId,
      ]);
    }
    return { pools, linked, created };
  });
});

/* ---------- TrueNAS import ---------- */

interface TruenasBody extends ConnOptions, ImportOptions {
  use_saved_key?: boolean;
  remember?: boolean;
  remember_key?: boolean;
}

async function truenasRequest(body: TruenasBody) {
  const b = body ?? ({} as TruenasBody);
  let key = (b.api_key ?? "").trim();
  if (!key && b.use_saved_key) {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='truenas'");
    key = rows[0]?.value?.api_key ?? "";
    if (!key) throw new HttpError(400, "No API key is saved. Enter one.");
  }
  const conn: ConnOptions = { url: b.url, api_key: key, insecure_tls: !!b.insecure_tls, allow_http: !!b.allow_http };
  const opts: ImportOptions = {
    server_id: b.server_id ? Number(b.server_id) : null,
    include_unused: b.include_unused !== false,
    include_shares: b.include_shares !== false,
    include_apps: b.include_apps !== false,
  };
  const snap = await fetchSnapshot(conn);
  const ex = {
    servers: (await pool.query("SELECT * FROM servers")).rows,
    pools: (await pool.query("SELECT * FROM pools")).rows,
    disks: (await pool.query("SELECT * FROM disks")).rows,
    services: (await pool.query("SELECT * FROM services")).rows,
    service_pools: (await pool.query("SELECT * FROM service_pools")).rows,
  };
  return { plan: planImport(snap, ex, opts), conn, opts, b };
}

app.post<{ Body: TruenasBody }>("/api/truenas/preview", async (req) => {
  const { plan } = await truenasRequest(req.body);
  return plan;
});

app.post<{ Body: TruenasBody }>("/api/truenas/apply", async (req) => {
  const { plan, conn, opts, b } = await truenasRequest(req.body);
  return tx(async (c) => {
    const result = await applyPlan(c, plan);
    if (b.remember) {
      const { rows } = await c.query("SELECT value FROM settings WHERE key='truenas'");
      const prevKey = rows[0]?.value?.api_key;
      const value = {
        url: conn.url, insecure_tls: conn.insecure_tls, allow_http: conn.allow_http,
        server_id: result.server_id, include_unused: opts.include_unused, include_shares: opts.include_shares, include_apps: opts.include_apps,
        last_sync: new Date().toISOString(),
        ...(b.remember_key ? { api_key: conn.api_key } : b.use_saved_key && prevKey ? { api_key: prevKey } : {}),
      };
      await c.query("INSERT INTO settings(key, value) VALUES ('truenas',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(value)]);
    }
    return result;
  });
});

app.delete("/api/truenas/saved", async () => {
  await pool.query("DELETE FROM settings WHERE key='truenas'");
  return { ok: true };
});

/* ---------- export / import ---------- */

const ORDER = ["racks", "servers", "pools", "disks", "services", "service_pools", "events"] as const;

app.get("/api/export", async (_req, reply) => {
  const out: Record<string, unknown> = { app: "zfstack", version: 1, exported_at: new Date().toISOString() };
  for (const name of ORDER) {
    const { rows } = await pool.query(`SELECT * FROM ${name} ORDER BY id`);
    out[name] = rows;
  }
  const { rows } = await pool.query("SELECT key, value FROM settings");
  const settings = publicSettings(rows);
  delete settings.truenas; // connection details stay on the server
  out.settings = settings;
  reply.header("Content-Disposition", `attachment; filename="zfstack-${today()}.json"`);
  return out;
});

async function wipe(c: import("pg").PoolClient) {
  await c.query(`TRUNCATE ${[...ORDER].reverse().join(", ")}, settings RESTART IDENTITY CASCADE`);
}

app.post<{ Body: Record<string, any> }>("/api/import", async (req) => {
  const body = req.body ?? {};
  if (body.app !== "zfstack") throw new HttpError(400, "This file is not a ZFStack export.");
  return tx(async (c) => {
    // Keep the saved TrueNAS connection: backups never contain it.
    const { rows: saved } = await c.query("SELECT value FROM settings WHERE key='truenas'");
    await wipe(c);
    if (saved[0]) await c.query("INSERT INTO settings(key, value) VALUES ('truenas',$1)", [JSON.stringify(saved[0].value)]);
    // Servers refer to other servers (host_id): insert without it first, then patch.
    const hosts: [number, number][] = [];
    for (const name of ORDER) {
      const rows: any[] = Array.isArray(body[name]) ? body[name] : [];
      for (const row of rows) {
        const cols = ["id", ...Object.keys(ENTITIES[name].columns), "created_at", "updated_at"].filter((k) => row[k] !== undefined);
        const values = cols.map((k) => (name === "servers" && k === "host_id" ? null : row[k]));
        if (name === "servers" && row.host_id) hosts.push([row.id, row.host_id]);
        await c.query(`INSERT INTO ${name} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, values);
      }
      await c.query(`SELECT setval(pg_get_serial_sequence('${name}','id'), GREATEST((SELECT COALESCE(max(id),0) FROM ${name}), 1), (SELECT count(*) > 0 FROM ${name}))`);
    }
    for (const [id, host] of hosts) await c.query("UPDATE servers SET host_id=$1 WHERE id=$2", [host, id]);
    for (const [k, v] of Object.entries(body.settings ?? {})) {
      if (k === "truenas") continue;
      await c.query("INSERT INTO settings(key, value) VALUES ($1,$2)", [k, JSON.stringify(v)]);
    }
    return { ok: true };
  });
});

app.post<{ Body: { confirm: string } }>("/api/erase", async (req) => {
  if (req.body?.confirm !== "erase") throw new HttpError(400, "Confirmation missing.");
  await tx(wipe);
  return { ok: true };
});

/* ---------- generic CRUD ---------- */

app.get<{ Params: { entity: string } }>("/api/:entity", async (req) => listAll(pool, getEntity(req.params.entity)));

app.post<{ Params: { entity: string }; Body: Record<string, unknown> }>("/api/:entity", async (req, reply) => {
  const e = getEntity(req.params.entity);
  const row = await insertRow(pool, e, clean(e, req.body ?? {}, false));
  return reply.status(201).send(row);
});

app.patch<{ Params: { entity: string; id: string }; Body: Record<string, unknown> }>("/api/:entity/:id", async (req) => {
  const e = getEntity(req.params.entity);
  return updateRow(pool, e, idParam(req.params.id), clean(e, req.body ?? {}, true));
});

app.delete<{ Params: { entity: string; id: string } }>("/api/:entity/:id", async (req, reply: FastifyReply) => {
  const e = getEntity(req.params.entity);
  await deleteRow(pool, e, idParam(req.params.id));
  return reply.status(204).send();
});

/* ---------- static web app ---------- */

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = [path.resolve(here, "../web"), path.resolve(here, "../../dist/web")].find((d) => existsSync(d));
if (webDir) {
  await app.register(fastifyStatic, { root: webDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "Not found" });
    return reply.sendFile("index.html");
  });
}

/* ---------- start ---------- */

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate();
      break;
    } catch (err: any) {
      if (attempt >= 30) throw err;
      app.log.warn(`Database not ready (${err.code ?? err.message}), retrying in 2 s…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
