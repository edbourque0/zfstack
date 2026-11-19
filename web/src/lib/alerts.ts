import type { Ref, State } from "../types";
import { daysSince, fmtGB, poolGeometry } from "./zfs";

export type Severity = "critical" | "warning" | "info";
export interface Alert {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  ref: Ref;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function computeAlerts(s: State): Alert[] {
  const out: Alert[] = [];
  const add = (a: Alert) => out.push(a);
  const poolById = new Map(s.pools.map((p) => [p.id, p]));
  const serverById = new Map(s.servers.map((x) => [x.id, x]));
  const active = (pid: number | null) => {
    const p = pid ? poolById.get(pid) : undefined;
    return p && p.status !== "planned" && p.status !== "retired" ? p : undefined;
  };

  for (const d of s.disks) {
    if (d.status === "retired" || d.status === "failed") continue;
    const pool = active(d.pool_id);
    const where = pool ? ` in ${pool.name}` : "";
    const ref: Ref = { type: "disk", id: d.id };
    if (d.status === "faulted")
      add({ key: `d${d.id}-f`, severity: "critical", title: `Disk ${d.serial} is faulted${where}`, detail: "Replace it and resilver.", ref });
    else if (d.status === "degraded")
      add({ key: `d${d.id}-g`, severity: "warning", title: `Disk ${d.serial} is degraded${where}`, detail: "Check cabling and SMART, then plan a replacement.", ref });
    if (d.smart_status === "failed")
      add({ key: `d${d.id}-sf`, severity: "critical", title: `SMART failed on ${d.serial}`, detail: pool ? `Data on ${pool.name} is at risk.` : "Do not put this disk in a pool.", ref });
    else if (d.smart_status === "warning")
      add({ key: `d${d.id}-sw`, severity: "warning", title: `SMART warning on ${d.serial}`, detail: "Run a long self-test and watch the counters.", ref });
    if ((d.reallocated_sectors ?? 0) >= 10 && d.smart_status !== "failed")
      add({ key: `d${d.id}-rs`, severity: "warning", title: `${d.reallocated_sectors} reallocated sectors on ${d.serial}`, detail: "A rising count means the disk is wearing out.", ref });
    if ((d.temperature_c ?? 0) >= 50)
      add({ key: `d${d.id}-t`, severity: d.temperature_c! >= 55 ? "critical" : "warning", title: `${d.serial} runs at ${d.temperature_c} °C`, detail: "Check airflow and fan speeds for that bay.", ref });
    if ((d.power_on_hours ?? 0) >= 50000 && pool)
      add({ key: `d${d.id}-h`, severity: "info", title: `${d.serial} has ${Math.round(d.power_on_hours! / 8766)} years of power-on time`, detail: "Keep a spare of this size ready.", ref });
    if (d.sector_size !== 512 && d.sector_size !== 4096 && d.status === "available")
      add({ key: `d${d.id}-sec`, severity: "info", title: `${d.serial} uses ${d.sector_size}-byte sectors`, detail: "Reformat with sg_format --format --size=512 before using it in ZFS.", ref });
    const left = d.warranty_until ? -(daysSince(d.warranty_until) ?? 0) : null;
    if (left !== null && left >= 0 && left <= 60)
      add({ key: `d${d.id}-w`, severity: "info", title: `Warranty on ${d.serial} ends in ${left} days`, detail: "Run a long SMART test now while you can still claim.", ref });
    if (pool && d.server_id === null)
      add({ key: `d${d.id}-loc`, severity: "info", title: `${d.serial} has no bay`, detail: `It belongs to ${pool.name}. Place it in the rack view.`, ref });
  }

  for (const p of s.pools) {
    if (p.status === "planned" || p.status === "retired") continue;
    const ref: Ref = { type: "pool", id: p.id };
    const g = poolGeometry(p, s.disks);
    if (p.status === "faulted") add({ key: `p${p.id}-f`, severity: "critical", title: `Pool ${p.name} is faulted`, detail: "Data is unavailable. Check every disk in it.", ref });
    if (p.status === "degraded") add({ key: `p${p.id}-g`, severity: "warning", title: `Pool ${p.name} is degraded`, detail: "Redundancy is reduced until the resilver finishes.", ref });
    const atRisk = g.data.filter((d) => ["faulted", "degraded"].includes(d.status) || d.smart_status === "failed").length;
    if (atRisk && g.tolerance > 0 && atRisk >= g.tolerance && p.status !== "faulted")
      add({ key: `p${p.id}-r`, severity: "critical", title: `${p.name} has no redundancy left`, detail: "One more disk failure loses the pool. Replace now.", ref });
    if (g.usable_gb > 0 && p.used_gb !== null) {
      const pct = p.used_gb / g.usable_gb;
      if (pct >= 0.8)
        add({ key: `p${p.id}-u`, severity: pct >= 0.9 ? "critical" : "warning", title: `${p.name} is ${Math.round(pct * 100)}% full`, detail: `${fmtGB(Math.max(0, g.usable_gb - p.used_gb))} left. ZFS slows down above 80%.`, ref });
    }
    const age = daysSince(p.last_scrub);
    if (age === null)
      add({ key: `p${p.id}-s0`, severity: "warning", title: `${p.name} has no recorded scrub`, detail: `Run zpool scrub ${p.name} and mark it done.`, ref });
    else if (age > p.scrub_interval_days)
      add({ key: `p${p.id}-s`, severity: "warning", title: `Scrub of ${p.name} is overdue`, detail: `Last scrub ${age} days ago; target every ${p.scrub_interval_days} days.`, ref });
    if (g.tolerance === 0 && g.data.length > 0) {
      const crit = s.service_pools.filter((m) => m.pool_id === p.id).map((m) => s.services.find((x) => x.id === m.service_id)).filter((x) => x && (x.criticality === "high" || x.criticality === "critical"));
      if (crit.length)
        add({ key: `p${p.id}-nr`, severity: "warning", title: `${p.name} has no redundancy`, detail: `${crit.map((x) => x!.name).join(", ")} depend on it.`, ref });
    }
    if (g.data.length && g.tolerance > 0) {
      const min = Math.min(...g.data.map((d) => d.capacity_gb));
      const hot = g.aux.spare.length;
      const cold = s.disks.some((d) => d.status === "available" && !d.pool_id && d.capacity_gb >= min);
      if (!hot && !cold)
        add({ key: `p${p.id}-sp`, severity: "info", title: `No spare fits ${p.name}`, detail: `Keep a ${fmtGB(min)} or larger disk on hand.`, ref });
    }
  }

  // Rack overlaps and servers outside the rack height.
  for (const r of s.racks) {
    const units = new Map<number, string>();
    for (const x of s.servers.filter((x) => x.rack_id === r.id && x.rack_u)) {
      for (let u = x.rack_u!; u < x.rack_u! + x.height_u; u++) {
        if (u > r.height_u)
          add({ key: `r${x.id}-h`, severity: "warning", title: `${x.name} sticks out of ${r.name}`, detail: `It needs U${x.rack_u}–U${x.rack_u! + x.height_u - 1}; the rack has ${r.height_u}U.`, ref: { type: "server", id: x.id } });
        const other = units.get(u);
        if (other && other !== x.name)
          add({ key: `r${x.id}-${u}`, severity: "warning", title: `${x.name} overlaps ${other} at U${u}`, detail: "Move one of them in the server settings.", ref: { type: "server", id: x.id } });
        units.set(u, x.name);
      }
    }
  }
  for (const x of s.servers) {
    const host = x.host_id ? serverById.get(x.host_id) : undefined;
    if (host && host.status === "offline" && x.status === "active")
      add({ key: `h${x.id}`, severity: "warning", title: `${x.name} is attached to ${host.name}, which is offline`, detail: "Its disks are unreachable.", ref: { type: "server", id: x.id } });
  }

  // Deduplicate per key and sort by severity.
  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
