/**
 * Parser for `zpool status` output. It turns the config tree into pools,
 * vdev groups and device names so ZFStack can map them onto known disks.
 */

export type Role = "data" | "spare" | "log" | "special" | "cache" | "dedup";

export interface ParsedDevice {
  name: string;
  state: string;
  vdev: string | null;
  role: Role;
  errors: { read: string; write: string; cksum: string } | null;
}

export interface ParsedPool {
  name: string;
  state: string;
  layout: string;
  scanLine: string | null;
  lastScrub: string | null;
  devices: ParsedDevice[];
}

const SECTION_ROLES: Record<string, Role> = {
  logs: "log",
  cache: "cache",
  spares: "spare",
  special: "special",
  dedup: "dedup",
};

const VDEV_RE = /^(mirror|raidz[123]?|draid[123]?(?::[\w:]+)?|replacing|spare)(-\d+)?$/;

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "scrub repaired 0B in 03:12:01 with 0 errors on Sun Nov 10 03:36:02 2026" -> "2026-11-10" */
export function scrubDate(scan: string): string | null {
  const m = scan.match(/on \w{3} (\w{3})\s+(\d{1,2}) [\d:]+ (\d{4})/);
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
}

function layoutFrom(vdevName: string): string {
  if (vdevName.startsWith("mirror")) return "mirror";
  const rz = vdevName.match(/^raidz([123])?/);
  if (rz) return `raidz${rz[1] ?? "1"}`;
  const dr = vdevName.match(/^draid([123])?/);
  if (dr) return `draid${dr[1] ?? "1"}`;
  return "stripe";
}

export function parseZpoolStatus(text: string): ParsedPool[] {
  const pools: ParsedPool[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let cur: ParsedPool | null = null;
  let inConfig = false;
  let poolIndent = -1;
  let role: Role = "data";
  let vdev: string | null = null;
  let vdevIndent = -1;
  let dataLayout: string | null = null;

  const finish = () => {
    if (cur) {
      cur.layout = dataLayout ?? "stripe";
      pools.push(cur);
    }
    cur = null;
    inConfig = false;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "        ");
    const header = line.match(/^\s*(pool|state|scan|config|errors):\s*(.*)$/);
    if (header) {
      const [, key, value] = header;
      if (key === "pool") {
        finish();
        cur = { name: value.trim(), state: "UNKNOWN", layout: "stripe", scanLine: null, lastScrub: null, devices: [] };
        role = "data";
        vdev = null;
        vdevIndent = -1;
        poolIndent = -1;
        dataLayout = null;
      } else if (cur && key === "state") cur.state = value.trim();
      else if (cur && key === "scan") {
        cur.scanLine = value.trim();
        cur.lastScrub = scrubDate(value);
      } else if (cur && key === "config") inConfig = true;
      else if (key === "errors") inConfig = false;
      continue;
    }
    if (!cur || !inConfig) continue;
    const m = line.match(/^(\s*)(\S+)(?:\s+(\S+))?(?:\s+(\S+)\s+(\S+)\s+(\S+))?/);
    if (!m) continue;
    const indent = m[1].length;
    const name = m[2];
    const state = m[3] ?? "";
    if (name === "NAME" && state === "STATE") continue;

    if (name === cur.name && poolIndent < 0) {
      poolIndent = indent;
      continue;
    }
    if (name === cur.name) continue;

    // Section headers (logs, cache, spares, special, dedup) sit at the pool's indent.
    if (SECTION_ROLES[name] && indent <= poolIndent + 0) {
      role = SECTION_ROLES[name];
      vdev = null;
      continue;
    }
    if (VDEV_RE.test(name)) {
      if (name.startsWith("replacing") || name.startsWith("spare-")) {
        // Keep the enclosing vdev; devices inside belong to it.
        continue;
      }
      vdev = name;
      vdevIndent = indent;
      if (role === "data" && !dataLayout) dataLayout = layoutFrom(name);
      continue;
    }
    // A device. If it is at or above the vdev's indent, it is a single-disk vdev.
    if (vdev && indent <= vdevIndent) vdev = null;
    if (role === "data" && !vdev && !dataLayout) dataLayout = "stripe";
    cur.devices.push({
      name,
      state: state || "UNKNOWN",
      vdev,
      role,
      errors: m[4] ? { read: m[4], write: m[5], cksum: m[6] } : null,
    });
  }
  finish();
  return pools;
}

/** Map a by-id / device name to a disk serial if one of the known serials appears in it. */
export function matchSerial(device: string, serials: string[]): string | null {
  const dev = device.toLowerCase();
  let best: string | null = null;
  for (const s of serials) {
    const k = s.toLowerCase();
    if (k.length >= 4 && dev.includes(k) && (!best || k.length > best.length)) best = s;
  }
  return best;
}

/** Best-effort serial from a /dev/disk/by-id name, e.g. ata-WDC_WD80EFAX-68KNBN0_VAGXXXXX -> VAGXXXXX. */
export function serialFromById(device: string): string {
  const base = device.replace(/^\/dev\/disk\/by-id\//, "").replace(/-part\d+$/, "");
  const m = base.match(/^(?:ata|scsi-SATA|scsi-S?\w*?|nvme|usb)[-_].*_([A-Za-z0-9-]+)$/);
  return m ? m[1] : base;
}

export function zfsState(state: string): "online" | "degraded" | "faulted" | "available" {
  const s = state.toUpperCase();
  if (s === "ONLINE") return "online";
  if (s === "AVAIL" || s === "INUSE") return "available";
  if (s === "DEGRADED") return "degraded";
  return "faulted";
}
