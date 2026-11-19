import type { Db } from "./db.js";

type ColType = "text" | "int" | "num" | "bool" | "date" | "ts";

export interface Entity {
  table: string;
  /** Writable columns and how to coerce incoming values. */
  columns: Record<string, ColType>;
  required: string[];
  order: string;
}

export const ENTITIES: Record<string, Entity> = {
  racks: {
    table: "racks",
    columns: { name: "text", height_u: "int", location: "text", notes: "text" },
    required: ["name"],
    order: "id",
  },
  servers: {
    table: "servers",
    columns: {
      name: "text", kind: "text", vendor: "text", model: "text", serial: "text",
      hostname: "text", ip: "text", os: "text", cpu: "text", ram_gb: "int",
      rack_id: "int", rack_u: "int", height_u: "int", bay_count: "int", bay_rows: "int",
      bay_form: "text", host_id: "int", status: "text", power_watts: "int",
      purchase_date: "date", warranty_until: "date", price: "num", notes: "text",
    },
    required: ["name"],
    order: "rack_u DESC NULLS LAST, name",
  },
  pools: {
    table: "pools",
    columns: {
      name: "text", server_id: "int", status: "text", layout: "text", draid_data: "int",
      draid_spares: "int", color: "int", ashift: "int", compression: "text",
      recordsize: "text", encryption: "bool", dedup: "bool", used_gb: "num",
      last_scrub: "date", scrub_interval_days: "int", last_snapshot: "date",
      purpose: "text", notes: "text",
    },
    required: ["name"],
    order: "name",
  },
  disks: {
    table: "disks",
    columns: {
      serial: "text", vendor: "text", model: "text", media: "text", interface: "text",
      capacity_gb: "num", rpm: "int", form_factor: "text", sector_size: "int",
      wwn: "text", firmware: "text", server_id: "int", bay: "int", pool_id: "int",
      vdev: "text", role: "text", status: "text", smart_status: "text",
      power_on_hours: "int", temperature_c: "int", reallocated_sectors: "int",
      last_smart_test: "date", purchase_date: "date", warranty_until: "date",
      price: "num", notes: "text",
    },
    required: ["serial", "capacity_gb"],
    order: "server_id NULLS LAST, bay NULLS LAST, serial",
  },
  services: {
    table: "services",
    columns: {
      name: "text", kind: "text", server_id: "int", status: "text", criticality: "text",
      url: "text", ip: "text", description: "text", backup_policy: "text", notes: "text",
    },
    required: ["name"],
    order: "name",
  },
  service_pools: {
    table: "service_pools",
    columns: {
      service_id: "int", pool_id: "int", dataset: "text", used_gb: "num",
      access: "text", notes: "text",
    },
    required: ["service_id", "pool_id"],
    order: "id",
  },
  events: {
    table: "events",
    columns: {
      at: "ts", kind: "text", title: "text", body: "text", disk_id: "int",
      pool_id: "int", server_id: "int", service_id: "int",
    },
    required: ["title"],
    order: "at DESC, id DESC",
  },
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function coerce(type: ColType, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  switch (type) {
    case "int": {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `Expected a whole number, got "${v}"`);
      return Math.round(n);
    }
    case "num": {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new HttpError(400, `Expected a number, got "${v}"`);
      return n;
    }
    case "bool":
      return v === true || v === "true" || v === 1 || v === "1";
    default:
      return typeof v === "string" ? v.trim() : String(v);
  }
}

/** Keep only known columns and coerce them; reject unknown entities. */
export function clean(entity: Entity, body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  for (const [col, type] of Object.entries(entity.columns)) {
    const v = coerce(type, body[col]);
    if (v !== undefined) out[col] = v;
  }
  if (!partial) {
    for (const r of entity.required) {
      if (out[r] === undefined || out[r] === null) throw new HttpError(400, `"${r}" is required`);
    }
  } else {
    for (const r of entity.required) {
      if (r in out && out[r] === null) throw new HttpError(400, `"${r}" cannot be empty`);
    }
  }
  return out;
}

export function getEntity(name: string): Entity {
  const e = ENTITIES[name];
  if (!e) throw new HttpError(404, `Unknown collection "${name}"`);
  return e;
}

export async function listAll(db: Db, e: Entity) {
  const { rows } = await db.query(`SELECT * FROM ${e.table} ORDER BY ${e.order}`);
  return rows;
}

export async function insertRow(db: Db, e: Entity, data: Record<string, unknown>) {
  const cols = Object.keys(data);
  if (!cols.length) throw new HttpError(400, "Nothing to save");
  const sql = `INSERT INTO ${e.table} (${cols.join(",")}) VALUES (${cols
    .map((_, i) => `$${i + 1}`)
    .join(",")}) RETURNING *`;
  const { rows } = await db.query(sql, cols.map((c) => data[c]));
  return rows[0];
}

export async function updateRow(db: Db, e: Entity, id: number, data: Record<string, unknown>) {
  const cols = Object.keys(data);
  if (!cols.length) {
    const { rows } = await db.query(`SELECT * FROM ${e.table} WHERE id=$1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Not found");
    return rows[0];
  }
  const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(",");
  const { rows } = await db.query(
    `UPDATE ${e.table} SET ${sets}, updated_at=now() WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((c) => data[c]), id],
  );
  if (!rows[0]) throw new HttpError(404, "Not found");
  return rows[0];
}

export async function deleteRow(db: Db, e: Entity, id: number) {
  const { rowCount } = await db.query(`DELETE FROM ${e.table} WHERE id=$1`, [id]);
  if (!rowCount) throw new HttpError(404, "Not found");
}

/** Translate Postgres constraint errors into readable 4xx messages. */
export function pgError(err: any): HttpError | null {
  if (!err || typeof err.code !== "string") return null;
  const detail: string = err.detail ?? err.message ?? "";
  switch (err.code) {
    case "23505":
      if (/server_id, bay/.test(detail)) return new HttpError(409, "That bay already holds a disk.");
      if (/serial/.test(detail)) return new HttpError(409, "A disk with that serial already exists.");
      if (/server_id, name/.test(detail)) return new HttpError(409, "That server already has a pool with this name.");
      return new HttpError(409, "That value is already used.");
    case "23503":
      return new HttpError(400, "It refers to something that no longer exists.");
    case "23514":
      return new HttpError(400, `A value is not allowed (${err.constraint ?? "check"}).`);
    case "22P02":
    case "22007":
    case "22008":
      return new HttpError(400, "A value has the wrong format.");
    default:
      return null;
  }
}
