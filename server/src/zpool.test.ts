import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSerial, parseZpoolStatus, scrubDate, serialFromById } from "./zpool.js";

const SAMPLE = `  pool: tank
 state: DEGRADED
status: One or more devices could not be used.
  scan: scrub repaired 0B in 03:12:01 with 0 errors on Sun Nov  9 03:36:02 2026
config:

	NAME                                   STATE     READ WRITE CKSUM
	tank                                   DEGRADED     0     0     0
	  raidz2-0                             DEGRADED     0     0     0
	    ata-WDC_WD80EFAX-68KNBN0_VAG11111  ONLINE       0     0     0
	    ata-WDC_WD80EFAX-68KNBN0_VAG22222  FAULTED      3   120     0
	    ata-WDC_WD80EFAX-68KNBN0_VAG33333  ONLINE       0     0     0
	    ata-WDC_WD80EFAX-68KNBN0_VAG44444  ONLINE       0     0     0
	special
	  mirror-1                             ONLINE       0     0     0
	    nvme-Samsung_SSD_980_S64ANS0T1     ONLINE       0     0     0
	    nvme-Samsung_SSD_980_S64ANS0T2     ONLINE       0     0     0
	logs
	  nvme-INTEL_SSDPE21D280GA_PHM2000     ONLINE       0     0     0
	cache
	  sdx                                  ONLINE       0     0     0
	spares
	  ata-WDC_WD80EFAX-68KNBN0_VAG55555    AVAIL

errors: No known data errors

  pool: rpool
 state: ONLINE
config:

	NAME        STATE     READ WRITE CKSUM
	rpool       ONLINE       0     0     0
	  mirror-0  ONLINE       0     0     0
	    sda3    ONLINE       0     0     0
	    sdb3    ONLINE       0     0     0

errors: No known data errors
`;

test("parses pools, vdevs and roles", () => {
  const pools = parseZpoolStatus(SAMPLE);
  assert.equal(pools.length, 2);
  const [tank, rpool] = pools;
  assert.equal(tank.name, "tank");
  assert.equal(tank.state, "DEGRADED");
  assert.equal(tank.layout, "raidz2");
  assert.equal(tank.lastScrub, "2026-11-09");
  assert.equal(tank.devices.length, 9);
  assert.deepEqual(
    tank.devices.map((d) => [d.role, d.vdev]),
    [
      ["data", "raidz2-0"], ["data", "raidz2-0"], ["data", "raidz2-0"], ["data", "raidz2-0"],
      ["special", "mirror-1"], ["special", "mirror-1"],
      ["log", null], ["cache", null], ["spare", null],
    ],
  );
  assert.equal(tank.devices[1].state, "FAULTED");
  assert.equal(tank.devices[8].state, "AVAIL");
  assert.equal(rpool.layout, "mirror");
  assert.equal(rpool.devices.length, 2);
});

test("stripe pools with single-disk vdevs", () => {
  const pools = parseZpoolStatus(`  pool: scratch
 state: ONLINE
config:

	NAME        STATE     READ WRITE CKSUM
	scratch     ONLINE       0     0     0
	  sdc       ONLINE       0     0     0
	  sdd       ONLINE       0     0     0

errors: No known data errors`);
  assert.equal(pools[0].layout, "stripe");
  assert.equal(pools[0].devices.length, 2);
  assert.equal(pools[0].devices[0].vdev, null);
});

test("matches serials inside by-id names", () => {
  assert.equal(matchSerial("ata-WDC_WD80EFAX-68KNBN0_VAG22222", ["VAG2222", "VAG22222"]), "VAG22222");
  assert.equal(matchSerial("sda", ["VAG22222"]), null);
  assert.equal(serialFromById("ata-WDC_WD80EFAX-68KNBN0_VAG22222-part1"), "VAG22222");
  assert.equal(scrubDate("scrub repaired 0B in 00:01:02 with 0 errors on Mon Dec  1 01:02:03 2025"), "2025-12-01");
});
