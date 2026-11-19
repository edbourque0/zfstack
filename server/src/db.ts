import pg from "pg";

// Return NUMERIC and BIGINT as JS numbers and DATE as a plain "YYYY-MM-DD" string.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://zfstack:zfstack@localhost:5440/zfstack",
  max: 10,
});

export type Db = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Ordered schema migrations. Append new entries; never edit an applied one. */
const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE racks (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    height_u    int  NOT NULL DEFAULT 42 CHECK (height_u BETWEEN 1 AND 60),
    location    text,
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE servers (
    id              serial PRIMARY KEY,
    name            text NOT NULL,
    kind            text NOT NULL DEFAULT 'server'
                    CHECK (kind IN ('server','jbod','nas','switch','ups','other')),
    vendor          text,
    model           text,
    serial          text,
    hostname        text,
    ip              text,
    os              text,
    cpu             text,
    ram_gb          int,
    rack_id         int REFERENCES racks(id) ON DELETE SET NULL,
    rack_u          int,
    height_u        int NOT NULL DEFAULT 2 CHECK (height_u BETWEEN 1 AND 12),
    bay_count       int NOT NULL DEFAULT 0 CHECK (bay_count BETWEEN 0 AND 120),
    bay_rows        int NOT NULL DEFAULT 1 CHECK (bay_rows BETWEEN 1 AND 12),
    bay_form        text NOT NULL DEFAULT '3.5' CHECK (bay_form IN ('2.5','3.5','nvme')),
    host_id         int REFERENCES servers(id) ON DELETE SET NULL,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','standby','maintenance','offline','retired','planned')),
    power_watts     int,
    purchase_date   date,
    warranty_until  date,
    price           numeric(10,2),
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE pools (
    id                  serial PRIMARY KEY,
    name                text NOT NULL,
    server_id           int REFERENCES servers(id) ON DELETE SET NULL,
    status              text NOT NULL DEFAULT 'online'
                        CHECK (status IN ('online','degraded','faulted','offline','migrating','planned','retired')),
    layout              text NOT NULL DEFAULT 'raidz1'
                        CHECK (layout IN ('stripe','mirror','raidz1','raidz2','raidz3','draid1','draid2','draid3')),
    draid_data          int,
    draid_spares        int NOT NULL DEFAULT 0,
    color               int,
    ashift              int NOT NULL DEFAULT 12,
    compression         text NOT NULL DEFAULT 'lz4',
    recordsize          text NOT NULL DEFAULT '128K',
    encryption          boolean NOT NULL DEFAULT false,
    dedup               boolean NOT NULL DEFAULT false,
    used_gb             numeric(12,1),
    last_scrub          date,
    scrub_interval_days int NOT NULL DEFAULT 30,
    last_snapshot       date,
    purpose             text,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (server_id, name)
  );

  CREATE TABLE disks (
    id                  serial PRIMARY KEY,
    serial              text NOT NULL UNIQUE,
    vendor              text,
    model               text,
    media               text NOT NULL DEFAULT 'hdd' CHECK (media IN ('hdd','ssd','nvme')),
    interface           text NOT NULL DEFAULT 'sata' CHECK (interface IN ('sata','sas','nvme','usb')),
    capacity_gb         numeric(10,1) NOT NULL CHECK (capacity_gb > 0),
    rpm                 int,
    form_factor         text NOT NULL DEFAULT '3.5' CHECK (form_factor IN ('2.5','3.5','m.2','u.2','pcie')),
    sector_size         int NOT NULL DEFAULT 512,
    wwn                 text,
    firmware            text,
    server_id           int REFERENCES servers(id) ON DELETE SET NULL,
    bay                 int,
    pool_id             int REFERENCES pools(id) ON DELETE SET NULL,
    vdev                text,
    role                text NOT NULL DEFAULT 'data'
                        CHECK (role IN ('data','spare','log','special','cache','dedup')),
    status              text NOT NULL DEFAULT 'online'
                        CHECK (status IN ('online','degraded','faulted','available','testing','failed','retired')),
    smart_status        text NOT NULL DEFAULT 'unknown'
                        CHECK (smart_status IN ('passed','warning','failed','unknown')),
    power_on_hours      int,
    temperature_c       int,
    reallocated_sectors int,
    last_smart_test     date,
    purchase_date       date,
    warranty_until      date,
    price               numeric(10,2),
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (server_id, bay)
  );
  CREATE INDEX disks_pool_idx ON disks(pool_id);
  CREATE INDEX disks_server_idx ON disks(server_id);

  CREATE TABLE services (
    id            serial PRIMARY KEY,
    name          text NOT NULL,
    kind          text NOT NULL DEFAULT 'docker'
                  CHECK (kind IN ('vm','lxc','docker','app','share','backup','baremetal')),
    server_id     int REFERENCES servers(id) ON DELETE SET NULL,
    status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','stopped','planned','retired')),
    criticality   text NOT NULL DEFAULT 'medium'
                  CHECK (criticality IN ('low','medium','high','critical')),
    url           text,
    ip            text,
    description   text,
    backup_policy text,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE service_pools (
    id          serial PRIMARY KEY,
    service_id  int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    pool_id     int NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    dataset     text,
    used_gb     numeric(12,1),
    access      text NOT NULL DEFAULT 'rw' CHECK (access IN ('rw','ro')),
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX service_pools_service_idx ON service_pools(service_id);
  CREATE INDEX service_pools_pool_idx ON service_pools(pool_id);

  CREATE TABLE events (
    id          serial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    kind        text NOT NULL DEFAULT 'note'
                CHECK (kind IN ('note','scrub','replace','failure','purchase','maintenance','migration','smart')),
    title       text NOT NULL,
    body        text,
    disk_id     int REFERENCES disks(id) ON DELETE SET NULL,
    pool_id     int REFERENCES pools(id) ON DELETE SET NULL,
    server_id   int REFERENCES servers(id) ON DELETE SET NULL,
    service_id  int REFERENCES services(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX events_at_idx ON events(at DESC);

  CREATE TABLE settings (
    key   text PRIMARY KEY,
    value jsonb NOT NULL
  );
  `,
];

export async function migrate(): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const { rows } = await pool.query<{ v: number | null }>(
    "SELECT max(version) AS v FROM schema_migrations",
  );
  const current = rows[0]?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    await tx(async (c) => {
      await c.query(MIGRATIONS[i]);
      await c.query("INSERT INTO schema_migrations(version) VALUES ($1)", [i + 1]);
    });
  }
}
