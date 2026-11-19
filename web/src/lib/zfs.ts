import type { Disk, Layout, Pool } from "../types";

/** Pool identity colours: validated categorical slots (colour-blind safe in this order). */
export const POOL_SLOTS = 6;

export const LAYOUT_LABEL: Record<Layout, string> = {
  stripe: "Stripe",
  mirror: "Mirror",
  raidz1: "RAIDZ1",
  raidz2: "RAIDZ2",
  raidz3: "RAIDZ3",
  draid1: "dRAID1",
  draid2: "dRAID2",
  draid3: "dRAID3",
};

export function parity(layout: Layout): number {
  const m = layout.match(/(\d)$/);
  return m ? Number(m[1]) : 0;
}

export interface VdevGeometry {
  name: string;
  disks: Disk[];
  usable_gb: number;
  tolerance: number;
}

export interface PoolGeometry {
  raw_gb: number;
  usable_gb: number;
  vdevs: VdevGeometry[];
  /** Disks that can fail in every vdev at once without data loss. */
  tolerance: number;
  data: Disk[];
  aux: Record<"spare" | "log" | "special" | "cache" | "dedup", Disk[]>;
  efficiency: number;
}

/** Usable capacity of one vdev of `n` disks whose smallest is `min` GB. */
export function vdevUsable(layout: Layout, n: number, min: number, sum: number, draid?: { data: number | null; spares: number }): number {
  if (n === 0) return 0;
  const p = parity(layout);
  if (layout === "stripe") return sum;
  if (layout === "mirror") return min;
  if (layout.startsWith("raidz")) return Math.max(0, n - p) * min;
  // dRAID: children minus distributed spares, scaled by data/(data+parity) per redundancy group.
  const spares = draid?.spares ?? 0;
  const avail = n - spares;
  const d = draid?.data && draid.data > 0 ? draid.data : Math.max(1, avail - p);
  if (avail <= p) return 0;
  return (avail * d) / (d + p) * min;
}

export function vdevTolerance(layout: Layout, n: number): number {
  if (layout === "stripe") return 0;
  if (layout === "mirror") return Math.max(0, n - 1);
  return Math.min(parity(layout), Math.max(0, n - 1));
}

/** ZFS keeps back roughly 1/32 of the pool (slop space). */
const SLOP = 1 - 1 / 32;

export function poolGeometry(pool: Pool, disks: Disk[]): PoolGeometry {
  const mine = disks.filter((d) => d.pool_id === pool.id);
  const data = mine.filter((d) => d.role === "data");
  const aux = {
    spare: mine.filter((d) => d.role === "spare"),
    log: mine.filter((d) => d.role === "log"),
    special: mine.filter((d) => d.role === "special"),
    cache: mine.filter((d) => d.role === "cache"),
    dedup: mine.filter((d) => d.role === "dedup"),
  };
  const groups = new Map<string, Disk[]>();
  for (const d of data) {
    // In a stripe every disk is its own vdev; otherwise unnamed disks share one vdev.
    const key = d.vdev || (pool.layout === "stripe" ? `disk-${d.serial}` : "vdev-0");
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const vdevs: VdevGeometry[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, ds]) => {
      const sizes = ds.map((d) => d.capacity_gb);
      const min = Math.min(...sizes);
      const sum = sizes.reduce((a, b) => a + b, 0);
      // Treat named single-disk vdevs in a non-stripe pool as stripe members.
      const layout: Layout = ds.length === 1 && pool.layout !== "stripe" && !pool.layout.startsWith("draid") ? "stripe" : pool.layout;
      return {
        name,
        disks: ds,
        usable_gb: vdevUsable(layout, ds.length, min, sum, { data: pool.draid_data, spares: pool.draid_spares }),
        tolerance: vdevTolerance(layout, ds.length),
      };
    });
  const raw = data.reduce((a, d) => a + d.capacity_gb, 0);
  const usable = vdevs.reduce((a, v) => a + v.usable_gb, 0) * SLOP;
  return {
    raw_gb: raw,
    usable_gb: usable,
    vdevs,
    tolerance: vdevs.length ? Math.min(...vdevs.map((v) => v.tolerance)) : 0,
    data,
    aux,
    efficiency: raw ? usable / raw : 0,
  };
}

/** Summary such as "RAIDZ2 · 1 × 11 × 1.2 TB". */
export function layoutSummary(pool: Pool, g: PoolGeometry): string {
  if (!g.vdevs.length) return LAYOUT_LABEL[pool.layout];
  const widths = new Set(g.vdevs.map((v) => v.disks.length));
  const sizes = new Set(g.data.map((d) => d.capacity_gb));
  const size = sizes.size === 1 ? fmtGB([...sizes][0]) : "mixed sizes";
  if (pool.layout === "stripe") return `Stripe · ${g.data.length} × ${size}`;
  const w = widths.size === 1 ? `${[...widths][0]}` : "mixed";
  return `${LAYOUT_LABEL[pool.layout]} · ${g.vdevs.length} × ${w}-wide · ${size}`;
}

export function toleranceText(t: number, layout: Layout): string {
  if (t === 0) return "No redundancy: any disk failure loses the pool";
  const per = layout === "mirror" || layout.startsWith("raidz") ? " per vdev" : "";
  return `Survives ${t} disk failure${t > 1 ? "s" : ""}${per}`;
}

/* ---------- formatting ---------- */

export function fmtGB(gb: number | null | undefined, digits = 1): string {
  if (gb === null || gb === undefined || !Number.isFinite(gb)) return "—";
  if (Math.abs(gb) >= 1000) {
    const tb = gb / 1000;
    return `${trim(tb.toFixed(tb >= 100 ? 0 : digits))} TB`;
  }
  return `${trim(gb.toFixed(gb >= 100 ? 0 : digits))} GB`;
}
const trim = (s: string) => s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const y = h / 8766;
  return y >= 1 ? `${y.toFixed(1)} y` : `${Math.round(h / 730)} mo`;
}

export function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date.length === 10 ? `${date}T00:00:00` : date);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export function fmtDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtAgo(date: string | null | undefined): string {
  const n = daysSince(date);
  if (n === null) return "never";
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 60) return `${n} days ago`;
  return `${Math.round(n / 30)} months ago`;
}

export function diskLabel(d: Disk): string {
  return [d.vendor, d.model].filter(Boolean).join(" ") || "Unknown model";
}

/** /dev/disk/by-id style placeholder for generated commands. */
export function devPath(d: Disk): string {
  return `/dev/disk/by-id/*${d.serial}`;
}

export function createCommand(pool: Pool, g: PoolGeometry): string {
  const opts = [
    `-o ashift=${pool.ashift}`,
    `-O compression=${pool.compression}`,
    `-O recordsize=${pool.recordsize}`,
    "-O atime=off",
    "-O xattr=sa",
  ];
  if (pool.encryption) opts.push("-O encryption=on -O keyformat=passphrase");
  const parts: string[] = [];
  const kw = pool.layout === "stripe" ? "" : pool.layout.startsWith("draid")
    ? `${pool.layout}${pool.draid_data ? `:${pool.draid_data}d` : ""}${pool.draid_spares ? `:${pool.draid_spares}s` : ""}`
    : pool.layout;
  for (const v of g.vdevs) parts.push(`  ${kw ? kw + " " : ""}${v.disks.map(devPath).join(" ")}`.trimEnd());
  const sec = (label: string, ds: Disk[], mirror: boolean) => {
    if (ds.length) parts.push(`  ${label}${mirror && ds.length > 1 ? " mirror" : ""} ${ds.map(devPath).join(" ")}`);
  };
  sec("special", g.aux.special, true);
  sec("dedup", g.aux.dedup, true);
  sec("log", g.aux.log, true);
  sec("cache", g.aux.cache, false);
  sec("spare", g.aux.spare, false);
  return `zpool create ${opts.join(" ")} ${pool.name} \\\n${parts.join(" \\\n")}`;
}
