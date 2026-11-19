import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtGB, poolGeometry, vdevUsable } from "./zfs";
import type { Disk, Pool } from "../types";

const pool = (over: Partial<Pool>): Pool => ({
  id: 1, name: "p", server_id: null, status: "online", layout: "raidz1", draid_data: null, draid_spares: 0,
  color: null, ashift: 12, compression: "lz4", recordsize: "128K", encryption: false, dedup: false,
  used_gb: null, last_scrub: null, scrub_interval_days: 30, last_snapshot: null, purpose: null, notes: null, ...over,
});
let n = 0;
const disk = (gb: number, over: Partial<Disk> = {}): Disk => ({
  id: ++n, serial: `S${n}`, vendor: null, model: null, media: "hdd", interface: "sata", capacity_gb: gb, rpm: null,
  form_factor: "3.5", sector_size: 512, wwn: null, firmware: null, server_id: null, bay: null, pool_id: 1,
  vdev: null, role: "data", status: "online", smart_status: "passed", power_on_hours: null, temperature_c: null,
  reallocated_sectors: null, last_smart_test: null, purchase_date: null, warranty_until: null, price: null, notes: null, ...over,
});

const SLOP = 1 - 1 / 32;

test("raidz1 of 9 × 2 TB gives 16 TB before slop", () => {
  const g = poolGeometry(pool({ layout: "raidz1" }), Array.from({ length: 9 }, () => disk(2000, { vdev: "raidz1-0" })));
  assert.equal(g.raw_gb, 18000);
  assert.equal(Math.round(g.usable_gb), Math.round(16000 * SLOP));
  assert.equal(g.tolerance, 1);
});

test("striped mirrors add one disk per vdev", () => {
  const ds = [0, 0, 1, 1, 2, 2, 3, 3].map((v) => disk(1200, { vdev: `mirror-${v}` }));
  ds.push(disk(100, { role: "log", vdev: "mirror-4" }), disk(100, { role: "log", vdev: "mirror-4" }));
  const g = poolGeometry(pool({ layout: "mirror" }), ds);
  assert.equal(g.vdevs.length, 4);
  assert.equal(Math.round(g.usable_gb), Math.round(4800 * SLOP));
  assert.equal(g.aux.log.length, 2);
  assert.equal(g.tolerance, 1);
});

test("raidz2 uses the smallest disk", () => {
  assert.equal(vdevUsable("raidz2", 6, 4000, 26000), 16000);
});

test("draid subtracts distributed spares and parity", () => {
  // 21 children, 1 spare, draid1 with default data width 19: 20 × 19/20 × 1.2 TB
  assert.equal(Math.round(vdevUsable("draid1", 21, 1200, 25200, { data: null, spares: 1 })), 22800);
});

test("formatting", () => {
  assert.equal(fmtGB(1200), "1.2 TB");
  assert.equal(fmtGB(100), "100 GB");
  assert.equal(fmtGB(16000), "16 TB");
  assert.equal(fmtGB(null), "—");
});
