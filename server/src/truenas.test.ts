import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, planImport, type Snapshot } from "./truenas.js";
import { FIXTURE } from "./truenas.fixture.js";

const snap: Snapshot = {
  transport: "websocket", info: FIXTURE.info, pools: FIXTURE.pools, disks: FIXTURE.disks, datasets: FIXTURE.datasets,
  temps: FIXTURE.temps, smb: FIXTURE.smb, nfs: FIXTURE.nfs, apps: FIXTURE.apps, appsPool: "fast", warnings: [],
};
const empty = { servers: [], pools: [], disks: [], services: [], service_pools: [] };

test("creates server, pools and disks from an empty inventory", () => {
  const plan = planImport(snap, empty, {});
  assert.equal(plan.server.id, null);
  assert.equal(plan.server.data.name, "truenas");
  assert.equal(plan.server.data.ram_gb, 64);
  assert.equal(plan.server.data.os, "TrueNAS 25.10.0");

  const movies = plan.pools.find((p) => p.name === "movies")!;
  assert.equal(movies.data.layout, "raidz1");
  assert.equal(movies.data.status, "degraded");
  assert.equal(movies.data.used_gb, 14200);
  assert.equal(movies.data.last_scrub, "2026-11-09");
  assert.equal(movies.missing, 1);
  assert.match(plan.warnings.join(" "), /movies: 1 device/);

  const fast = plan.pools.find((p) => p.name === "fast")!;
  assert.equal(fast.data.layout, "mirror");
  assert.equal(fast.vdevs, 2);
  assert.equal(fast.data.encryption, true);
  assert.equal(fast.data.compression, "zstd");

  const by = (s: string) => plan.disks.find((d) => d.serial === s)!;
  assert.deepEqual([by("ZL2A0").data.vdev, by("ZL2A0").data.role, by("ZL2A0").pool], ["raidz1-0", "data", "movies"]);
  assert.equal(by("ZL2A2").data.status, "faulted");
  assert.equal(by("ZL2A2").data.temperature_c, 51);
  assert.deepEqual([by("ZL2A3").data.role, by("ZL2A3").data.status], ["spare", "available"]);
  assert.deepEqual([by("NVMECACHE").data.role, by("NVMECACHE").data.media, by("NVMECACHE").data.interface], ["cache", "nvme", "nvme"]);
  assert.deepEqual([by("OPT0").data.role, by("OPT0").data.vdev], ["special", "mirror-2"]);
  assert.equal(by("ZL2A0").data.capacity_gb, 8001.6);
  assert.equal(by("UNUSED1").pool, null);
  assert.equal(by("UNUSED1").data.status, "available");
  assert.equal(plan.disks.length, 12);
});

test("maps shares and apps to pools, including the apps pool", () => {
  const plan = planImport(snap, empty, {});
  const smb = plan.services.find((s) => s.name === "SMB · media")!;
  assert.deepEqual(smb.maps, [{ pool: "movies", dataset: "movies/library", access: "rw" }]);
  const nfs = plan.services.find((s) => s.name === "NFS · /mnt/fast/vm")!;
  assert.equal(nfs.maps[0].pool, "fast");
  const jf = plan.services.find((s) => s.name === "jellyfin")!;
  assert.deepEqual(jf.maps.map((m) => m.pool).sort(), ["fast", "movies"]);
  assert.equal(planImport(snap, empty, { include_apps: false, include_shares: false }).services.length, 0);
});

test("updates existing records and unlinks disks that left the pool", () => {
  const ex = {
    servers: [{ id: 7, name: "truenas", hostname: null, vendor: "Custom", model: null, serial: null }],
    pools: [{ id: 3, name: "movies", server_id: 7 }],
    disks: [
      { id: 10, serial: "zl2a0", pool_id: 3, model: null, capacity_gb: 1, server_id: 2, bay: 4 },
      { id: 11, serial: "OLDDISK", pool_id: 3 },
    ],
    services: [{ id: 5, name: "jellyfin", kind: "docker", server_id: 7 }],
    service_pools: [],
  };
  const plan = planImport(snap, ex, {});
  assert.equal(plan.server.id, 7);
  assert.equal(plan.server.data.vendor, undefined, "keeps a vendor the user set");
  assert.equal(plan.pools.find((p) => p.name === "movies")!.id, 3);
  const d = plan.disks.find((x) => x.serial === "ZL2A0")!;
  assert.equal(d.id, 10, "matches serials case-insensitively");
  assert.equal(d.data.server_id, undefined, "never moves a disk out of its bay");
  assert.deepEqual(plan.unlink, [{ id: 11, serial: "OLDDISK", pool: "movies" }]);
  assert.equal(plan.services.find((s) => s.name === "jellyfin")!.id, 5);
});

test("refuses plain HTTP unless allowed", () => {
  assert.throws(() => normalizeUrl("http://truenas.lab"), /revokes API keys/);
  assert.equal(normalizeUrl("http://truenas.lab", true).protocol, "http:");
  assert.equal(normalizeUrl("truenas.lab/").toString(), "https://truenas.lab/");
});
