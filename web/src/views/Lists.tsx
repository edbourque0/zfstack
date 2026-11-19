import { useMemo, useState } from "react";
import {
  ArrowLeftRight, Boxes, CalendarCheck, Database, Download, HardDrive, NotebookPen, Plus, Search, Server as ServerIcon, ShoppingCart, Stethoscope, Truck, Wrench, XOctagon, type LucideIcon,
} from "lucide-react";
import { useStore } from "../store";
import type { Disk, EventKind, Service } from "../types";
import {
  Button, DataTable, DiskStatus, Empty, Meter, PoolChip, PoolStatus, PoolSwatch, SmartStatus, Tag, downloadFile, toCsv, type Column,
} from "../components/ui";
import { BulkDiskDialog, EditDialog } from "../components/forms";
import { CRIT_COLOR, KIND_LABEL, SVC_KIND, location } from "../components/details";
import { daysSince, diskLabel, fmtAgo, fmtDate, fmtGB, fmtHours, layoutSummary, toleranceText } from "../lib/zfs";
import { savedTruenas } from "./TruenasImport";
import { RefreshCw } from "lucide-react";

function Head({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div><h1 className="page-title">{title}</h1><p className="page-sub">{sub}</p></div>
      <div className="row">{children}</div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="cp-input-wrap" style={{ width: 280, maxWidth: "100%" }}>
      <Search size={16} />
      <input className="cp-input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

const match = (q: string, ...xs: (string | number | null | undefined)[]) => !q || xs.some((x) => x !== null && x !== undefined && String(x).toLowerCase().includes(q));

/* ---------------- Disks ---------------- */

export function DisksView() {
  const store = useStore();
  const { state } = store;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState<null | "one" | "bulk">(null);
  const query = q.trim().toLowerCase();
  const rows = state.disks.filter((d) => {
    const s = store.server(d.server_id), p = store.pool(d.pool_id);
    if (!match(query, d.serial, d.model, d.vendor, d.vdev, s?.name, p?.name, d.wwn)) return false;
    switch (filter) {
      case "problems": return ["degraded", "faulted", "failed"].includes(d.status) || ["warning", "failed"].includes(d.smart_status);
      case "spare": return !d.pool_id && d.status === "available";
      case "nobay": return d.server_id === null || d.bay === null;
      case "retired": return ["retired", "failed"].includes(d.status);
      case "all": return true;
      default: return filter.startsWith("p") ? d.pool_id === Number(filter.slice(1)) : d.server_id === Number(filter.slice(1));
    }
  });
  const cols: Column<Disk>[] = [
    { key: "loc", label: "Location", render: (d) => <span className="muted">{location(d, store.server(d.server_id))}</span>, sort: (d) => `${store.server(d.server_id)?.name ?? "~"}${String(d.bay ?? 999).padStart(3, "0")}` },
    { key: "serial", label: "Serial", render: (d) => <span className="cp-db-title mono">{d.serial}</span>, sort: (d) => d.serial },
    { key: "model", label: "Model", render: (d) => diskLabel(d), sort: (d) => diskLabel(d) },
    { key: "size", label: "Size", align: "r", render: (d) => fmtGB(d.capacity_gb), sort: (d) => d.capacity_gb },
    { key: "type", label: "Type", render: (d) => <span className="muted">{d.media.toUpperCase()} · {d.interface.toUpperCase()}{d.rpm ? ` · ${(d.rpm / 1000).toFixed(1).replace(".0", "")}K` : ""}</span>, sort: (d) => d.media },
    { key: "pool", label: "Pool", render: (d) => <PoolChip pool={store.pool(d.pool_id)} />, sort: (d) => store.pool(d.pool_id)?.name ?? "~" },
    { key: "vdev", label: "Vdev · role", render: (d) => d.pool_id ? <span className="muted"><span className="mono">{d.vdev ?? "—"}</span>{d.role !== "data" ? ` · ${d.role}` : ""}</span> : null, sort: (d) => `${d.vdev ?? ""}${d.role}` },
    { key: "status", label: "Status", render: (d) => <DiskStatus d={d} />, sort: (d) => d.status },
    { key: "smart", label: "SMART", render: (d) => <SmartStatus d={d} />, sort: (d) => d.smart_status },
    { key: "temp", label: "Temp", align: "r", render: (d) => (d.temperature_c !== null ? `${d.temperature_c} °C` : "—"), sort: (d) => d.temperature_c },
    { key: "age", label: "Powered on", align: "r", render: (d) => fmtHours(d.power_on_hours), sort: (d) => d.power_on_hours },
  ];
  const exportCsv = () =>
    downloadFile(`zfstack-disks-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows.map((d) => ({
      serial: d.serial, vendor: d.vendor, model: d.model, capacity_gb: d.capacity_gb, media: d.media, interface: d.interface, rpm: d.rpm,
      server: store.server(d.server_id)?.name, bay: d.bay, pool: store.pool(d.pool_id)?.name, vdev: d.vdev, role: d.role, status: d.status,
      smart: d.smart_status, temperature_c: d.temperature_c, power_on_hours: d.power_on_hours, reallocated_sectors: d.reallocated_sectors,
      purchase_date: d.purchase_date, warranty_until: d.warranty_until, price: d.price, wwn: d.wwn,
    }))));
  const totalPrice = rows.reduce((a, d) => a + (d.price ?? 0), 0);
  const totalGB = rows.reduce((a, d) => a + d.capacity_gb, 0);

  return (
    <div className="page">
      <Head title="Disks" sub="Every drive you own: where it sits, which pool it serves and how healthy it is.">
        <Button variant="outline" onClick={() => setDialog("bulk")}>Add several</Button>
        <Button onClick={() => setDialog("one")}><Plus size={16} /> Disk</Button>
      </Head>
      <div className="cp-db-bar">
        <SearchBox value={q} onChange={setQ} placeholder="Search serial, model, pool, server" />
        <select className="cp-select" style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter disks">
          <option value="all">All disks</option>
          <option value="problems">With problems</option>
          <option value="spare">Unused spares</option>
          <option value="nobay">Not in a bay</option>
          <option value="retired">Failed or retired</option>
          <optgroup label="Pool">{state.pools.map((p) => <option key={p.id} value={`p${p.id}`}>{p.name}</option>)}</optgroup>
          <optgroup label="Server">{state.servers.filter((s) => s.bay_count).map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
        </select>
        <span className="spacer" />
        <Button variant="ghost" size="sm" onClick={exportCsv} disabled={!rows.length}><Download size={14} /> CSV</Button>
      </div>
      <div>
        <DataTable
          rows={rows}
          columns={cols}
          onRow={(d) => store.open({ type: "disk", id: d.id })}
          empty={<Empty icon={<HardDrive size={28} />} title={state.disks.length ? "No disk matches" : "No disks yet"} action={!state.disks.length && <Button onClick={() => setDialog("one")}><Plus size={16} /> Add disk</Button>}>
            {state.disks.length ? "Change the search or the filter." : "Add disks one at a time, several at once, or import them from zpool status in Tools."}
          </Empty>}
        />
        {rows.length > 0 && <div className="table-foot">{rows.length} disks · {fmtGB(totalGB)} raw{totalPrice ? ` · ${totalPrice.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })} spent · ${(totalPrice / (totalGB / 1000)).toFixed(2)} per TB` : ""}</div>}
      </div>
      {dialog === "one" && <EditDialog collection="disks" onClose={() => setDialog(null)} onSaved={(d) => store.open({ type: "disk", id: d.id })} />}
      {dialog === "bulk" && <BulkDiskDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ---------------- Servers ---------------- */

export function ServersView() {
  const store = useStore();
  const { state } = store;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const query = q.trim().toLowerCase();
  const rows = state.servers.filter((s) => match(query, s.name, s.model, s.vendor, s.hostname, s.ip, s.serial, s.os));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Name", render: (s) => <span className="cp-db-title">{s.name}</span>, sort: (s) => s.name },
    { key: "kind", label: "Type", render: (s) => KIND_LABEL[s.kind], sort: (s) => s.kind },
    { key: "model", label: "Model", render: (s) => [s.vendor, s.model].filter(Boolean).join(" ") || "—", sort: (s) => s.model ?? "" },
    { key: "rack", label: "Rack", render: (s) => { const r = state.racks.find((x) => x.id === s.rack_id); return r ? `${r.name}${s.rack_u ? ` · U${s.rack_u}` : ""}` : <span className="muted">—</span>; }, sort: (s) => s.rack_u },
    { key: "bays", label: "Bays used", align: "r", render: (s) => s.bay_count ? `${state.disks.filter((d) => d.server_id === s.id && d.bay !== null).length} / ${s.bay_count}` : "—", sort: (s) => s.bay_count },
    { key: "raw", label: "Raw", align: "r", render: (s) => fmtGB(state.disks.filter((d) => d.server_id === s.id).reduce((a, d) => a + d.capacity_gb, 0) || null), sort: (s) => state.disks.filter((d) => d.server_id === s.id).reduce((a, d) => a + d.capacity_gb, 0) },
    { key: "svc", label: "Services", align: "r", render: (s) => state.services.filter((x) => x.server_id === s.id).length || "—" },
    { key: "ip", label: "IP", render: (s) => s.ip ? <span className="mono">{s.ip}</span> : "—", sort: (s) => s.ip },
    { key: "status", label: "Status", render: (s) => <Tag color={s.status === "active" ? "green" : s.status === "offline" ? "rose" : s.status === "maintenance" ? "amber" : "gray"}>{s.status[0].toUpperCase() + s.status.slice(1)}</Tag>, sort: (s) => s.status },
  ];
  const watts = state.servers.reduce((a, s) => a + (s.status === "active" ? s.power_watts ?? 0 : 0), 0);
  return (
    <div className="page">
      <Head title="Servers" sub="Hosts, NAS heads and disk shelves. Each bay is a location for a disk.">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Server</Button>
      </Head>
      <div className="cp-db-bar"><SearchBox value={q} onChange={setQ} placeholder="Search name, model, IP" /></div>
      <div>
        <DataTable rows={rows} columns={cols} onRow={(s) => store.open({ type: "server", id: s.id })}
          empty={<Empty icon={<ServerIcon size={28} />} title={state.servers.length ? "No server matches" : "No servers yet"} action={!state.servers.length && <Button onClick={() => setOpen(true)}><Plus size={16} /> Add server</Button>} />} />
        {rows.length > 0 && watts > 0 && <div className="table-foot">Active equipment draws about {watts} W · {(watts * 24 * 30 / 1000).toFixed(0)} kWh a month</div>}
      </div>
      {open && <EditDialog collection="servers" defaults={state.racks[0] ? { rack_id: state.racks[0].id } : undefined} onClose={() => setOpen(false)} onSaved={(s) => store.open({ type: "server", id: s.id })} />}
    </div>
  );
}

/* ---------------- Pools ---------------- */

export function PoolsView({ go }: { go: (r: string) => void }) {
  const store = useStore();
  const { state } = store;
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const saved = savedTruenas(state.settings);
  const sync = async () => {
    if (!saved) return;
    setSyncing(true);
    const r = await store.action<{ pools: number; disks: number; created: number; unlinked: number }>("/api/truenas/apply", {
      url: saved.url, use_saved_key: true, insecure_tls: saved.insecure_tls, allow_http: saved.allow_http, server_id: saved.server_id,
      include_unused: saved.include_unused, include_shares: saved.include_shares, include_apps: saved.include_apps, remember: true,
    });
    setSyncing(false);
    if (r) store.toast(`Synced ${r.pools} pools and ${r.disks} disks from TrueNAS${r.created ? `, ${r.created} new` : ""}${r.unlinked ? `, ${r.unlinked} left their pool` : ""}.`);
  };
  return (
    <div className="page">
      <Head title="Pools" sub="Layout, capacity, redundancy and scrub health of every ZFS pool.">
        {saved?.has_key ? (
          <Button variant="outline" disabled={syncing} onClick={sync} title={`Read pools again from ${saved.url}`}><RefreshCw size={16} /> {syncing ? "Syncing…" : "Sync TrueNAS"}</Button>
        ) : (
          <Button variant="outline" onClick={() => go("tools/truenas")}>Import from TrueNAS</Button>
        )}
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Pool</Button>
      </Head>
      {state.pools.length ? (
        <div className="pool-cards">
          {state.pools.map((p) => {
            const g = store.geometry(p);
            const host = store.server(p.server_id);
            const svc = state.service_pools.filter((m) => m.pool_id === p.id).length;
            const scrubAge = daysSince(p.last_scrub);
            const overdue = p.status !== "planned" && (scrubAge === null || scrubAge > p.scrub_interval_days);
            const all = [...g.data, ...Object.values(g.aux).flat()];
            return (
              <button key={p.id} className="cp-card card-click" onClick={() => store.open({ type: "pool", id: p.id })} style={{ gap: 12 }}>
                <div className="row" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span className="pool-card-name"><PoolSwatch pool={p} size={12} /><span className="mono">{p.name}</span></span>
                  <PoolStatus p={p} />
                </div>
                <div className="muted" style={{ marginTop: -8 }}>{layoutSummary(p, g)}{host ? ` · ${host.name}` : ""}</div>
                <div className="stack" style={{ gap: 4, width: "100%" }}>
                  <Meter value={p.used_gb ?? 0} max={g.usable_gb} label={`${p.name} used`} />
                  <div className="row caption muted num" style={{ justifyContent: "space-between" }}>
                    <span>{fmtGB(p.used_gb)} used</span><span>≈ {fmtGB(g.usable_gb)} usable · {fmtGB(g.raw_gb)} raw</span>
                  </div>
                </div>
                {all.length > 0 && (
                  <div className="mini-bays" aria-label={`${all.length} disks`}>
                    {all.map((d) => (
                      <span key={d.id} className={`mini-bay ${d.role !== "data" ? "bay-hatch" : ""}`} title={`${d.serial} · ${d.status}`}
                        style={{ background: ["faulted", "failed", "degraded"].includes(d.status) || d.smart_status === "failed" ? "var(--st-critical)" : store.poolColor(p) !== null ? `var(--pool-${store.poolColor(p)})` : "var(--muted-foreground)" }} />
                    ))}
                  </div>
                )}
                <div className="caption" style={{ display: "grid", gap: 2 }}>
                  <span>{g.data.length ? toleranceText(g.tolerance, p.layout) : "No data disks yet"}</span>
                  <span className="muted">
                    {p.status === "planned" ? "Planned" : <>Scrubbed {fmtAgo(p.last_scrub)}{overdue && <strong style={{ color: "var(--warning)" }}> · overdue</strong>}</>}
                    {" · "}{svc} service{svc === 1 ? "" : "s"}
                    {g.aux.log.length ? " · SLOG" : ""}{g.aux.special.length ? " · special" : ""}{g.aux.cache.length ? " · L2ARC" : ""}{p.encryption ? " · encrypted" : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty icon={<Database size={28} />} title="No pools yet" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Create pool</Button>}>
          Create pools by hand, or paste <span className="mono">zpool status</span> in Tools to import them with their disks.
        </Empty>
      )}
      {open && <EditDialog collection="pools" onClose={() => setOpen(false)} onSaved={(p) => store.open({ type: "pool", id: p.id })} />}
    </div>
  );
}

/* ---------------- Services ---------------- */

export function ServicesView() {
  const store = useStore();
  const { state } = store;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const query = q.trim().toLowerCase();
  const rows = state.services.filter((s) => match(query, s.name, s.description, s.url, s.ip, store.server(s.server_id)?.name));
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const cols: Column<Service>[] = [
    { key: "name", label: "Name", render: (s) => <span className="cp-db-title">{s.name}</span>, sort: (s) => s.name },
    { key: "kind", label: "Type", render: (s) => SVC_KIND[s.kind], sort: (s) => s.kind },
    { key: "host", label: "Runs on", render: (s) => store.server(s.server_id)?.name ?? "—", sort: (s) => store.server(s.server_id)?.name ?? "~" },
    {
      key: "pools", label: "Pools", render: (s) => {
        const ps = state.service_pools.filter((m) => m.service_id === s.id).map((m) => store.pool(m.pool_id)).filter(Boolean);
        return ps.length ? <span className="row" style={{ gap: 10 }}>{ps.map((p) => <PoolChip key={p!.id} pool={p!} />)}</span> : <span className="muted">None mapped</span>;
      },
    },
    { key: "used", label: "Space", align: "r", render: (s) => fmtGB(state.service_pools.filter((m) => m.service_id === s.id).reduce((a, m) => a + (m.used_gb ?? 0), 0) || null), sort: (s) => state.service_pools.filter((m) => m.service_id === s.id).reduce((a, m) => a + (m.used_gb ?? 0), 0) },
    {
      key: "risk", label: "Weakest pool", render: (s) => {
        const ps = state.service_pools.filter((m) => m.service_id === s.id).map((m) => store.pool(m.pool_id)).filter((p) => p && p.status !== "planned");
        const bad = ps.find((p) => p && ["faulted", "degraded", "offline"].includes(p.status));
        if (bad) return <PoolStatus p={bad} />;
        const g = ps.map((p) => store.geometry(p!)).filter((x) => x.data.length);
        if (!g.length) return <span className="muted">—</span>;
        const t = Math.min(...g.map((x) => x.tolerance));
        return t === 0 ? <Tag color="amber">No redundancy</Tag> : <span className="muted">{t}-disk tolerance</span>;
      },
    },
    { key: "crit", label: "Criticality", render: (s) => <Tag color={CRIT_COLOR[s.criticality]}>{s.criticality[0].toUpperCase() + s.criticality.slice(1)}</Tag>, sort: (s) => rank[s.criticality] },
    { key: "status", label: "Status", render: (s) => <span className={s.status === "running" ? "" : "muted"}>{s.status[0].toUpperCase() + s.status.slice(1)}</span>, sort: (s) => s.status },
  ];
  return (
    <div className="page">
      <Head title="Services" sub="What runs in the lab and which pools, and therefore which disks, it depends on.">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Service</Button>
      </Head>
      <div className="cp-db-bar"><SearchBox value={q} onChange={setQ} placeholder="Search services" /></div>
      <DataTable rows={rows} columns={cols} onRow={(s) => store.open({ type: "service", id: s.id })}
        empty={<Empty icon={<Boxes size={28} />} title={state.services.length ? "No service matches" : "No services yet"} action={!state.services.length && <Button onClick={() => setOpen(true)}><Plus size={16} /> Add service</Button>}>
          {!state.services.length && "Add VMs, containers, shares and backup jobs, then map each one to the pools it uses."}
        </Empty>} />
      {open && <EditDialog collection="services" onClose={() => setOpen(false)} onSaved={(s) => store.open({ type: "service", id: s.id })} />}
    </div>
  );
}

/* ---------------- Log ---------------- */

export const EVENT_ICON: Record<EventKind, LucideIcon> = {
  note: NotebookPen, scrub: CalendarCheck, replace: ArrowLeftRight, failure: XOctagon, purchase: ShoppingCart, maintenance: Wrench, migration: Truck, smart: Stethoscope,
};
const EVENT_WORD: Record<EventKind, string> = {
  note: "Notes", scrub: "Scrubs", replace: "Replacements", failure: "Failures", purchase: "Purchases", maintenance: "Maintenance", migration: "Migrations", smart: "SMART",
};

export function LogView() {
  const store = useStore();
  const { state } = store;
  const [kind, setKind] = useState<"all" | EventKind>("all");
  const [edit, setEdit] = useState<null | Record<string, any>>(null);
  const rows = state.events.filter((e) => kind === "all" || e.kind === kind);
  const grouped = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const e of rows) {
      const k = new Date(e.at).toLocaleDateString(undefined, { year: "numeric", month: "long" });
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [rows]);
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <Head title="Log" sub="A maintenance journal: replacements, scrubs, purchases and notes, linked to what they touched.">
        <Button onClick={() => setEdit({})}><Plus size={16} /> Entry</Button>
      </Head>
      <div className="cp-db-bar">
        <select className="cp-select" style={{ width: 200 }} value={kind} onChange={(e) => setKind(e.target.value as any)} aria-label="Filter log">
          <option value="all">All entries</option>
          {(Object.keys(EVENT_WORD) as EventKind[]).map((k) => <option key={k} value={k}>{EVENT_WORD[k]}</option>)}
        </select>
      </div>
      {grouped.length ? grouped.map(([month, evs]) => (
        <section key={month} className="cp-card" style={{ paddingTop: 16 }}>
          <div className="cp-card-title">{month}</div>
          <ul className="timeline">
            {evs.map((e) => {
              const Icon = EVENT_ICON[e.kind];
              const disk = store.disk(e.disk_id), pool = store.pool(e.pool_id), server = store.server(e.server_id), svc = store.service(e.service_id);
              return (
                <li key={e.id}>
                  <span className="tl-icon"><Icon size={14} /></span>
                  <div style={{ minWidth: 0 }}>
                    <button className="pool-chip tl-title" onClick={() => setEdit(e)}>{e.title}</button>
                    {e.body && <div className="tl-body">{e.body}</div>}
                    {(disk || pool || server || svc) && (
                      <div className="tl-links">
                        {disk && <button className="disk-chip" onClick={() => store.open({ type: "disk", id: disk.id })}>{disk.serial}</button>}
                        {pool && <PoolChip pool={pool} />}
                        {server && <button className="pool-chip" onClick={() => store.open({ type: "server", id: server.id })}><ServerIcon size={13} />{server.name}</button>}
                        {svc && <button className="pool-chip" onClick={() => store.open({ type: "service", id: svc.id })}><Boxes size={13} />{svc.name}</button>}
                      </div>
                    )}
                  </div>
                  <span className="caption muted nowrap">{fmtDate(e.at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )) : (
        <Empty icon={<NotebookPen size={28} />} title="Nothing logged yet">ZFStack logs replacements, scrubs and imports for you. Add your own notes too.</Empty>
      )}
      {edit && <EditDialog collection="events" row={edit.id ? edit : null} title={edit.id ? "Edit log entry" : "New log entry"} onClose={() => setEdit(null)} />}
    </div>
  );
}
