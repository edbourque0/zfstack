import { useState } from "react";
import { CheckCircle2, Database, HardDrive, Plus, Server as ServerIcon, Warehouse } from "lucide-react";
import { useStore } from "../store";
import { Button, Meter, PoolStatus, PoolSwatch, SeverityIcon } from "../components/ui";
import { EditDialog } from "../components/forms";
import { fmtAgo, fmtDate, fmtGB, layoutSummary } from "../lib/zfs";
import { EVENT_ICON } from "./Lists";

export default function Dashboard({ go }: { go: (r: string) => void }) {
  const store = useStore();
  const { state, alerts } = store;
  const [dialog, setDialog] = useState<null | "rack" | "server" | "pool" | "disk">(null);
  const [showAll, setShowAll] = useState(false);

  const livePools = state.pools.filter((p) => p.status !== "planned" && p.status !== "retired");
  const geos = livePools.map((p) => ({ p, g: store.geometry(p) }));
  const raw = geos.reduce((a, x) => a + x.g.raw_gb, 0);
  const usable = geos.reduce((a, x) => a + x.g.usable_gb, 0);
  const used = livePools.reduce((a, p) => a + (p.used_gb ?? 0), 0);
  const inUse = state.disks.filter((d) => d.pool_id && !["retired", "failed"].includes(d.status));
  const spares = state.disks.filter((d) => d.status === "available" && !d.pool_id);
  const totalBays = state.servers.reduce((a, s) => a + s.bay_count, 0);
  const filled = state.disks.filter((d) => d.server_id && d.bay !== null).length;
  const issues = state.disks.filter((d) => ["degraded", "faulted"].includes(d.status) || ["warning", "failed"].includes(d.smart_status)).length;
  const crit = alerts.filter((a) => a.severity === "critical").length;
  const shown = showAll ? alerts : alerts.slice(0, 8);

  const empty = !state.servers.length && !state.disks.length && !state.pools.length;
  if (empty) {
    const steps: [string, string, () => void, boolean][] = [
      ["Create a rack", "Give it a name and a height in U.", () => setDialog("rack"), state.racks.length > 0],
      ["Add your servers and disk shelves", "Set the number of bays: each bay becomes a disk location.", () => setDialog("server"), state.servers.length > 0],
      ["Create your pools", "Name, host and layout. Or paste zpool status in Tools to import them.", () => setDialog("pool"), state.pools.length > 0],
      ["Add your disks", "Click an empty bay in the rack view, or add many at once from Disks.", () => setDialog("disk"), state.disks.length > 0],
      ["Map services to pools", "So you know what each pool and disk carries.", () => go("services"), state.services.length > 0],
    ];
    return (
      <div className="page" style={{ maxWidth: 820 }}>
        <div>
          <h1 className="page-title">Welcome to ZFStack</h1>
          <p className="page-sub">Your inventory is empty. Five steps map your whole lab, from rack to dataset.</p>
        </div>
        <ol className="link-list" style={{ listStyle: "none" }}>
          {steps.map(([t, d, fn, done], i) => (
            <li key={t}>
              <button className="link-row" style={{ padding: "14px 16px", alignItems: "flex-start" }} onClick={fn}>
                <span className="tl-icon" style={done ? { background: "var(--ribbon-soft)", color: "var(--ribbon)" } : undefined}>
                  {done ? <CheckCircle2 size={16} /> : <span className="num" style={{ fontWeight: 600 }}>{i + 1}</span>}
                </span>
                <span>
                  <span style={{ fontWeight: 500, display: "block" }}>{t}</span>
                  <span className="muted">{d}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="caption muted">Have a backup? Restore it from Settings.</div>
        {dialog === "rack" && <EditDialog collection="racks" onClose={() => setDialog(null)} />}
        {dialog === "server" && <EditDialog collection="servers" defaults={state.racks[0] ? { rack_id: state.racks[0].id } : undefined} onClose={() => setDialog(null)} />}
        {dialog === "pool" && <EditDialog collection="pools" onClose={() => setDialog(null)} />}
        {dialog === "disk" && <EditDialog collection="disks" onClose={() => setDialog(null)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">
            {crit ? `${crit} critical issue${crit === 1 ? "" : "s"} need you now.` : alerts.length ? `${alerts.length} thing${alerts.length === 1 ? "" : "s"} to look at.` : "Everything looks healthy."}
          </p>
        </div>
        <div className="row">
          <Button variant="outline" onClick={() => go("rack")}><Warehouse size={16} /> Open rack</Button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label"><Database size={14} /> Usable capacity</span>
          <span className="kpi-value">{fmtGB(usable)}</span>
          <span className="kpi-sub">{fmtGB(raw)} raw in {livePools.length} pool{livePools.length === 1 ? "" : "s"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Used</span>
          <span className="kpi-value">{fmtGB(used)}</span>
          <span className="kpi-sub">{usable ? `${Math.round((used / usable) * 100)}% of usable · ${fmtGB(Math.max(0, usable - used))} free` : "Set used space on each pool"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label"><HardDrive size={14} /> Disks in pools</span>
          <span className="kpi-value">{inUse.length}</span>
          <span className="kpi-sub">{issues ? `${issues} with problems` : "No disk problems"} · {state.disks.length} total</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Spare disks</span>
          <span className="kpi-value">{spares.length}</span>
          <span className="kpi-sub">{fmtGB(spares.reduce((a, d) => a + d.capacity_gb, 0))} unused</span>
        </div>
        <div className="kpi">
          <span className="kpi-label"><ServerIcon size={14} /> Free bays</span>
          <span className="kpi-value">{Math.max(0, totalBays - filled)}</span>
          <span className="kpi-sub">{filled} of {totalBays} filled in {state.servers.filter((s) => s.bay_count).length} enclosures</span>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="cp-card">
          <div className="cp-card-head"><span className="cp-card-title">Needs attention</span><span className="muted caption">{alerts.length}</span></div>
          {alerts.length ? (
            <>
              <ul className="alert-list">
                {shown.map((a) => (
                  <li key={a.key}>
                    <button className={`alert-row sev-${a.severity}`} onClick={() => store.open(a.ref)}>
                      <SeverityIcon s={a.severity} />
                      <span>
                        <span className="alert-title">{a.title}</span>
                        <span className="muted" style={{ display: "block" }}>{a.detail}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {alerts.length > 8 && <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${alerts.length}`}</Button>}
            </>
          ) : (
            <div className="row muted"><CheckCircle2 size={16} style={{ color: "var(--success)" }} /> No disk, pool or rack issues.</div>
          )}
        </section>

        <section className="cp-card">
          <div className="cp-card-head">
            <span className="cp-card-title">Pools</span>
            <Button variant="ghost" size="sm" onClick={() => setDialog("pool")}><Plus size={14} /> Pool</Button>
          </div>
          {state.pools.length ? (
            <div>
              {state.pools.map((p) => {
                const g = store.geometry(p);
                const pct = g.usable_gb && p.used_gb !== null ? p.used_gb / g.usable_gb : null;
                return (
                  <button key={p.id} className="pool-row" onClick={() => store.open({ type: "pool", id: p.id })}>
                    <span style={{ minWidth: 0 }}>
                      <span className="pool-name"><PoolSwatch pool={p} /><span className="mono">{p.name}</span></span>
                      <span className="caption muted" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{layoutSummary(p, g)}</span>
                    </span>
                    <span className="stack" style={{ gap: 4 }}>
                      <Meter value={p.used_gb ?? 0} max={g.usable_gb} label={`${p.name} used`} />
                      <span className="caption muted num">{fmtGB(p.used_gb)} of {fmtGB(g.usable_gb)}{pct !== null ? ` · ${Math.round(pct * 100)}%` : ""} · scrubbed {fmtAgo(p.last_scrub)}</span>
                    </span>
                    <span style={{ justifySelf: "end" }}><PoolStatus p={p} /></span>
                  </button>
                );
              })}
            </div>
          ) : <div className="muted">No pools yet.</div>}
        </section>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="cp-card">
          <div className="cp-card-head">
            <span className="cp-card-title">Critical services</span>
            <Button variant="ghost" size="sm" onClick={() => go("services")}>All services</Button>
          </div>
          {(() => {
            const list = state.services.filter((s) => s.status !== "retired" && (s.criticality === "critical" || s.criticality === "high"));
            if (!list.length) return <div className="muted">Mark services as high or critical to track them here.</div>;
            return (
              <ul className="link-list">
                {list.map((s) => {
                  const pools = state.service_pools.filter((m) => m.service_id === s.id).map((m) => store.pool(m.pool_id)).filter(Boolean);
                  const worst = pools.find((p) => p && ["faulted", "degraded", "offline"].includes(p.status));
                  return (
                    <li key={s.id}>
                      <button className="link-row" onClick={() => store.open({ type: "service", id: s.id })}>
                        {s.name}
                        <span className="row" style={{ gap: 4 }}>{pools.map((p) => <PoolSwatch key={p!.id} pool={p!} />)}</span>
                        <span className="meta">{worst ? <PoolStatus p={worst} /> : pools.length ? `${pools.length} pool${pools.length === 1 ? "" : "s"}` : "No pool mapped"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </section>

        <section className="cp-card">
          <div className="cp-card-head">
            <span className="cp-card-title">Recent activity</span>
            <Button variant="ghost" size="sm" onClick={() => go("log")}>Open log</Button>
          </div>
          {state.events.length ? (
            <ul className="timeline">
              {state.events.slice(0, 5).map((e) => {
                const Icon = EVENT_ICON[e.kind];
                return (
                  <li key={e.id}>
                    <span className="tl-icon"><Icon size={14} /></span>
                    <span><span className="tl-title">{e.title}</span>{e.body && <span className="tl-body" style={{ display: "block" }}>{e.body}</span>}</span>
                    <span className="caption muted nowrap">{fmtDate(e.at)}</span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="muted">Replacements, scrubs and notes show up here.</div>}
        </section>
      </div>
      {dialog === "pool" && <EditDialog collection="pools" onClose={() => setDialog(null)} />}
    </div>
  );
}
