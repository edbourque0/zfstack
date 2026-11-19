import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeftRight, Boxes, CalendarCheck, Database, ExternalLink, HardDrive, Layers, Link2, NotebookPen, Pencil, Plus, Server as ServerIcon, Trash2, Unplug, X,
} from "lucide-react";
import { useStore } from "../store";
import type { Disk, Pool, Ref, Server, Service } from "../types";
import {
  Button, CodeBlock, Confirm, Dialog, DiskStatus, Field, Meter, PoolChip, PoolStatus, PoolSwatch, Props, SmartStatus, Status, Tag,
} from "./ui";
import { EditDialog } from "./forms";
import {
  LAYOUT_LABEL, createCommand, diskLabel, fmtAgo, fmtDate, fmtGB, fmtHours, layoutSummary, toleranceText,
} from "../lib/zfs";
import { ServerFace } from "../views/RackView";

const ROLE_LABEL: Record<Disk["role"], string> = {
  data: "Data", spare: "Hot spare", log: "SLOG (log)", special: "Special (metadata)", cache: "L2ARC (cache)", dedup: "Dedup",
};
export const KIND_LABEL: Record<Server["kind"], string> = { server: "Server", nas: "NAS", jbod: "JBOD", switch: "Switch", ups: "UPS", other: "Other" };
export const SVC_KIND: Record<Service["kind"], string> = { vm: "VM", lxc: "LXC", docker: "Docker", app: "App", share: "Share", backup: "Backup", baremetal: "Bare metal" };
export const CRIT_COLOR = { low: "gray", medium: "blue", high: "amber", critical: "rose" } as const;

export function location(d: Disk, server: Server | undefined): string {
  if (!server) return "Not installed";
  return d.bay !== null ? `${server.name} · bay ${d.bay}` : `${server.name} · no bay`;
}

export function DetailDrawer() {
  const { detail, open } = useStore();
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".overlay") && open(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, open]);
  if (!detail) return null;
  return (
    <div className="drawer-wrap">
      <div className="overlay-soft" onClick={() => open(null)} />
      <aside className="drawer" role="dialog" aria-label="Details">
        {detail.type === "disk" && <DiskDetail id={detail.id} />}
        {detail.type === "server" && <ServerDetail id={detail.id} />}
        {detail.type === "pool" && <PoolDetail id={detail.id} />}
        {detail.type === "service" && <ServiceDetail id={detail.id} />}
      </aside>
    </div>
  );
}

function Head({ kicker, icon, title, children }: { kicker: string; icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  const { open } = useStore();
  return (
    <div className="drawer-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="drawer-kicker">{icon}{kicker}</div>
        <div className="drawer-title">{title}</div>
        {children}
      </div>
      <Button variant="ghost" size="sm" icon aria-label="Close details" onClick={() => open(null)}><X size={16} /></Button>
    </div>
  );
}

function Missing() {
  return (
    <>
      <Head kicker="Not found" icon={null} title="This item was deleted" />
      <div className="drawer-body muted">Close this panel to continue.</div>
    </>
  );
}

function LinkRow({ to, children, meta }: { to: Ref; children: ReactNode; meta?: ReactNode }) {
  const { open } = useStore();
  return (
    <li>
      <button className="link-row" onClick={() => open(to)}>
        {children}
        {meta && <span className="meta">{meta}</span>}
      </button>
    </li>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="sub-title">{title}<span className="spacer" />{action}</div>
      {children}
    </section>
  );
}

function EventsFor({ filter }: { filter: (e: { disk_id: number | null; pool_id: number | null; server_id: number | null; service_id: number | null }) => boolean }) {
  const { state } = useStore();
  const evs = state.events.filter(filter).slice(0, 6);
  if (!evs.length) return <div className="muted">Nothing logged yet.</div>;
  return (
    <ul className="timeline">
      {evs.map((e) => (
        <li key={e.id} style={{ gridTemplateColumns: "1fr auto" }}>
          <div>
            <div className="tl-title">{e.title}</div>
            {e.body && <div className="tl-body">{e.body}</div>}
          </div>
          <span className="muted caption nowrap">{fmtDate(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Disk ---------------- */

function DiskDetail({ id }: { id: number }) {
  const store = useStore();
  const d = store.disk(id);
  const [edit, setEdit] = useState(false);
  const [replace, setReplace] = useState(false);
  const [log, setLog] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  if (!d) return <Missing />;
  const server = store.server(d.server_id);
  const pool = store.pool(d.pool_id);
  const g = pool ? store.geometry(pool) : null;
  const vdev = g?.vdevs.find((v) => v.disks.some((x) => x.id === d.id));
  const services = pool
    ? store.state.service_pools.filter((m) => m.pool_id === pool.id).map((m) => ({ m, s: store.service(m.service_id)! })).filter((x) => x.s)
    : [];
  const healthyInVdev = vdev ? vdev.disks.filter((x) => x.id !== d.id && x.status === "online").length : 0;
  const failuresLeft = vdev ? vdev.tolerance - vdev.disks.filter((x) => x.id !== d.id && ["faulted", "degraded", "failed"].includes(x.status)).length : 0;

  return (
    <>
      <Head kicker="Disk" icon={<HardDrive size={12} />} title={<span className="mono" style={{ fontSize: 19 }}>{d.serial}</span>}>
        <div className="row" style={{ marginTop: 6 }}>
          <DiskStatus d={d} />
          <span className="muted">{diskLabel(d)} · {fmtGB(d.capacity_gb)}</span>
        </div>
      </Head>
      <div className="drawer-body">
        <div className="drawer-actions">
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</Button>
          {pool && <Button size="sm" variant="outline" onClick={() => setReplace(true)}><ArrowLeftRight size={14} /> Replace</Button>}
          {server && <Button size="sm" variant="outline" onClick={() => setConfirmPull(true)}><Unplug size={14} /> Remove from bay</Button>}
          <Button size="sm" variant="outline" onClick={() => setLog(true)}><NotebookPen size={14} /> Log</Button>
        </div>

        {pool && vdev && (
          <div className={`cp-callout ${failuresLeft <= 0 ? "cp-callout-danger" : "cp-callout-info"}`}>
            <Layers size={16} />
            <div>
              <div className="cp-callout-title">If this disk fails</div>
              {failuresLeft <= 0
                ? <>{pool.name} loses data: <span className="mono">{vdev.name}</span> has no redundancy left.</>
                : <>{pool.name} keeps running. <span className="mono">{vdev.name}</span> could then lose {failuresLeft - 1 > 0 ? `${failuresLeft - 1} more` : "no more"} disk{failuresLeft - 1 === 1 ? "" : "s"}. {healthyInVdev} other disk{healthyInVdev === 1 ? " is" : "s are"} healthy in it.</>}
                {services.length > 0 && <> Services on this pool: {services.map((x) => x.s.name).join(", ")}.</>}
            </div>
          </div>
        )}

        <Section title="Location">
          <Props items={[
            ["Server", server ? <button className="pool-chip" onClick={() => store.open({ type: "server", id: server.id })}><ServerIcon size={14} />{server.name}</button> : "Not installed"],
            ["Bay", d.bay !== null ? `Bay ${d.bay}` : null],
          ]} />
        </Section>
        <Section title="ZFS">
          <Props items={[
            ["Pool", pool ? <PoolChip pool={pool} /> : "Not in a pool"],
            ["Role", ROLE_LABEL[d.role]],
            ["Vdev", d.vdev ? <span className="mono">{d.vdev}</span> : null],
            ["Device path", <span className="mono caption">/dev/disk/by-id/*{d.serial}</span>],
          ]} />
        </Section>
        <Section title="Health">
          <Props items={[
            ["SMART", <SmartStatus d={d} />],
            ["Last SMART test", d.last_smart_test ? `${fmtDate(d.last_smart_test)} (${fmtAgo(d.last_smart_test)})` : null],
            ["Temperature", d.temperature_c !== null ? `${d.temperature_c} °C` : null],
            ["Power-on time", d.power_on_hours !== null ? `${d.power_on_hours.toLocaleString()} h (${fmtHours(d.power_on_hours)})` : null],
            ["Reallocated sectors", d.reallocated_sectors],
            ["Sector size", d.sector_size !== 512 && d.sector_size !== 4096 ? <Status tone="warning">{d.sector_size} bytes · reformat before ZFS</Status> : `${d.sector_size} bytes`],
          ]} />
        </Section>
        <Section title="Hardware">
          <Props items={[
            ["Model", diskLabel(d)],
            ["Capacity", fmtGB(d.capacity_gb)],
            ["Type", `${d.media.toUpperCase()} · ${d.interface.toUpperCase()}${d.rpm ? ` · ${d.rpm.toLocaleString()} rpm` : ""}`],
            ["Form factor", d.form_factor.includes(".") ? `${d.form_factor}"` : d.form_factor.toUpperCase()],
            ["WWN", d.wwn ? <span className="mono">{d.wwn}</span> : null],
            ["Firmware", d.firmware],
            ["Purchased", d.purchase_date ? fmtDate(d.purchase_date) : null],
            ["Warranty until", d.warranty_until ? fmtDate(d.warranty_until) : null],
            ["Price", d.price !== null ? d.price.toLocaleString(undefined, { style: "currency", currency: "USD" }) : null],
          ]} />
        </Section>
        {d.notes && <Section title="Notes"><div style={{ whiteSpace: "pre-wrap" }}>{d.notes}</div></Section>}
        <Section title="Commands">
          <CodeBlock code={`smartctl -a /dev/disk/by-id/*${d.serial}\nsmartctl -t long /dev/disk/by-id/*${d.serial}`} />
        </Section>
        <Section title="History"><EventsFor filter={(e) => e.disk_id === d.id} /></Section>
      </div>
      {edit && <EditDialog collection="disks" row={d} onClose={() => setEdit(false)} />}
      {replace && <ReplaceDialog disk={d} onClose={() => setReplace(false)} />}
      {log && <EditDialog collection="events" title="Log entry" defaults={{ disk_id: d.id, pool_id: d.pool_id, server_id: d.server_id, kind: "maintenance" }} onClose={() => setLog(false)} />}
      {confirmPull && (
        <Confirm
          title="Remove this disk from its bay?"
          body="It stays in your inventory and keeps its pool membership. Drag it back onto any empty bay in the rack view."
          confirmLabel="Remove from bay"
          danger={false}
          onClose={() => setConfirmPull(false)}
          onConfirm={() => store.action(`/api/disks/${d.id}/move`, { server_id: null, bay: null }, "Disk removed from its bay.")}
        />
      )}
    </>
  );
}

function ReplaceDialog({ disk, onClose }: { disk: Disk; onClose: () => void }) {
  const store = useStore();
  const pool = store.pool(disk.pool_id);
  const candidates = store.state.disks.filter((x) => x.id !== disk.id && !x.pool_id && !["failed", "retired", "faulted"].includes(x.status));
  const fits = candidates.filter((x) => x.capacity_gb >= disk.capacity_gb);
  const [pick, setPick] = useState(fits[0]?.id ? String(fits[0].id) : "");
  const [oldStatus, setOldStatus] = useState("failed");
  const chosen = store.disk(Number(pick));
  return (
    <Dialog
      title={`Replace ${disk.serial}`}
      description="The new disk takes this disk's bay, pool, vdev and role. This one leaves the bay."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!pick} onClick={async () => {
            const ok = await store.action(`/api/disks/${disk.id}/replace`, { replacement_id: Number(pick), old_status: oldStatus }, "Disk replaced and logged.");
            if (ok) { onClose(); store.open({ type: "disk", id: Number(pick) }); }
          }}>Replace disk</Button>
        </>
      }
    >
      <Field label="Replacement disk" help={fits.length < candidates.length ? `${candidates.length - fits.length} smaller disks are hidden; they would not fit.` : undefined}>
        <select className="cp-select" value={pick} onChange={(e) => setPick(e.target.value)}>
          {!fits.length && <option value="">No unused disk of {fmtGB(disk.capacity_gb)} or more</option>}
          {fits.map((x) => (
            <option key={x.id} value={x.id}>{x.serial} · {fmtGB(x.capacity_gb)} · {diskLabel(x)} · {location(x, store.server(x.server_id))}</option>
          ))}
        </select>
      </Field>
      <Field label="Mark the old disk as">
        <select className="cp-select" value={oldStatus} onChange={(e) => setOldStatus(e.target.value)}>
          <option value="failed">Failed</option>
          <option value="retired">Retired (still works)</option>
        </select>
      </Field>
      {chosen && pool && (
        <>
          <div className="sub-title" style={{ marginBottom: -8 }}>Run on {store.server(pool.server_id)?.name ?? "the host"}</div>
          <CodeBlock code={`zpool replace ${pool.name} /dev/disk/by-id/*${disk.serial} /dev/disk/by-id/*${chosen.serial}\nzpool status ${pool.name}`} />
        </>
      )}
    </Dialog>
  );
}

/* ---------------- Server ---------------- */

function ServerDetail({ id }: { id: number }) {
  const store = useStore();
  const s = store.server(id);
  const [edit, setEdit] = useState(false);
  const [log, setLog] = useState(false);
  if (!s) return <Missing />;
  const disks = store.state.disks.filter((d) => d.server_id === s.id).sort((a, b) => (a.bay ?? 999) - (b.bay ?? 999));
  const poolIds = new Set([...store.state.pools.filter((p) => p.server_id === s.id).map((p) => p.id), ...disks.map((d) => d.pool_id).filter(Boolean) as number[]]);
  const pools = store.state.pools.filter((p) => poolIds.has(p.id));
  const services = store.state.services.filter((x) => x.server_id === s.id);
  const attached = store.state.servers.filter((x) => x.host_id === s.id);
  const host = store.server(s.host_id);
  const rack = store.state.racks.find((r) => r.id === s.rack_id);
  const raw = disks.reduce((a, d) => a + d.capacity_gb, 0);
  const free = s.bay_count - disks.filter((d) => d.bay !== null).length;

  return (
    <>
      <Head kicker={KIND_LABEL[s.kind]} icon={<ServerIcon size={12} />} title={s.name}>
        <div className="muted" style={{ marginTop: 2 }}>{[s.vendor, s.model].filter(Boolean).join(" ") || "No model set"}</div>
      </Head>
      <div className="drawer-body">
        <div className="drawer-actions">
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setLog(true)}><NotebookPen size={14} /> Log</Button>
        </div>
        {s.bay_count > 0 && (
          <Section title={`Front panel · ${free} of ${s.bay_count} bays free · ${fmtGB(raw)} raw`}>
            <div style={{ height: Math.max(56, s.height_u * 30) }}>
              <ServerFace server={s} mode="pool" compact />
            </div>
          </Section>
        )}
        <Section title="System">
          <Props items={[
            ["Status", <Tag color={s.status === "active" ? "green" : s.status === "offline" ? "rose" : "gray"}>{s.status[0].toUpperCase() + s.status.slice(1)}</Tag>],
            ["Hostname", s.hostname], ["IP address", s.ip ? <span className="mono">{s.ip}</span> : null], ["OS", s.os], ["CPU", s.cpu],
            ["RAM", s.ram_gb ? `${s.ram_gb} GB` : null], ["Serial number", s.serial ? <span className="mono">{s.serial}</span> : null],
            ["Rack", rack ? `${rack.name}${s.rack_u ? ` · U${s.rack_u}${s.height_u > 1 ? `–U${s.rack_u + s.height_u - 1}` : ""}` : ""}` : "Not in a rack"],
            ["Power draw", s.power_watts ? `${s.power_watts} W` : null],
            ["Warranty until", s.warranty_until ? fmtDate(s.warranty_until) : null],
          ]} />
        </Section>
        {(host || attached.length > 0) && (
          <Section title="Connections">
            <ul className="link-list">
              {host && <LinkRow to={{ type: "server", id: host.id }} meta="Host"><Link2 size={14} /> {host.name}</LinkRow>}
              {attached.map((x) => <LinkRow key={x.id} to={{ type: "server", id: x.id }} meta={KIND_LABEL[x.kind]}><Link2 size={14} /> {x.name}</LinkRow>)}
            </ul>
          </Section>
        )}
        <Section title={`Pools · ${pools.length}`}>
          {pools.length ? (
            <ul className="link-list">
              {pools.map((p) => <LinkRow key={p.id} to={{ type: "pool", id: p.id }} meta={<PoolStatus p={p} />}><PoolSwatch pool={p} /> {p.name}</LinkRow>)}
            </ul>
          ) : <div className="muted">No pools on this server.</div>}
        </Section>
        <Section title={`Services · ${services.length}`}>
          {services.length ? (
            <ul className="link-list">
              {services.map((x) => <LinkRow key={x.id} to={{ type: "service", id: x.id }} meta={SVC_KIND[x.kind]}>{x.name}</LinkRow>)}
            </ul>
          ) : <div className="muted">No services run here yet.</div>}
        </Section>
        <Section title={`Disks · ${disks.length}`}>
          {disks.length ? (
            <ul className="link-list">
              {disks.map((d) => (
                <LinkRow key={d.id} to={{ type: "disk", id: d.id }} meta={<DiskStatus d={d} />}>
                  <span className="muted mono caption" style={{ width: 44 }}>{d.bay !== null ? `bay ${d.bay}` : "—"}</span>
                  <span className="mono">{d.serial}</span>
                  <span className="muted">{fmtGB(d.capacity_gb)}</span>
                </LinkRow>
              ))}
            </ul>
          ) : <div className="muted">No disks installed.</div>}
        </Section>
        {s.notes && <Section title="Notes"><div style={{ whiteSpace: "pre-wrap" }}>{s.notes}</div></Section>}
        <Section title="History"><EventsFor filter={(e) => e.server_id === s.id} /></Section>
      </div>
      {edit && <EditDialog collection="servers" row={s} onClose={() => setEdit(false)} />}
      {log && <EditDialog collection="events" title="Log entry" defaults={{ server_id: s.id, kind: "maintenance" }} onClose={() => setLog(false)} />}
    </>
  );
}

/* ---------------- Pool ---------------- */

function PoolDetail({ id }: { id: number }) {
  const store = useStore();
  const p = store.pool(id);
  const [edit, setEdit] = useState(false);
  const [map, setMap] = useState<null | Record<string, any>>(null);
  const [scrub, setScrub] = useState(false);
  if (!p) return <Missing />;
  const g = store.geometry(p);
  const host = store.server(p.server_id);
  const maps = store.state.service_pools.filter((m) => m.pool_id === p.id);
  const pct = g.usable_gb && p.used_gb !== null ? p.used_gb / g.usable_gb : null;
  const chip = (d: Disk) => (
    <button
      key={d.id}
      className={`disk-chip ${["faulted", "failed"].includes(d.status) || d.smart_status === "failed" ? "bad" : d.status === "degraded" || d.smart_status === "warning" ? "warn" : ""}`}
      onClick={() => store.open({ type: "disk", id: d.id })}
      title={`${diskLabel(d)} · ${fmtGB(d.capacity_gb)} · ${location(d, store.server(d.server_id))}`}
    >
      {d.serial}
    </button>
  );
  const auxRows: [string, Disk[]][] = [["Special (metadata)", g.aux.special], ["Dedup", g.aux.dedup], ["SLOG (log)", g.aux.log], ["L2ARC (cache)", g.aux.cache], ["Hot spares", g.aux.spare]];

  return (
    <>
      <Head kicker="Pool" icon={<Database size={12} />} title={<span className="row"><PoolSwatch pool={p} size={12} /><span className="mono">{p.name}</span></span>}>
        <div className="row" style={{ marginTop: 6 }}>
          <PoolStatus p={p} />
          <span className="muted">{layoutSummary(p, g)}{host ? ` · on ${host.name}` : ""}</span>
        </div>
      </Head>
      <div className="drawer-body">
        <div className="drawer-actions">
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setScrub(true)}><CalendarCheck size={14} /> Mark scrubbed</Button>
          <Button size="sm" variant="outline" onClick={() => setMap({ pool_id: p.id })}><Plus size={14} /> Map a service</Button>
        </div>
        <Section title="Capacity">
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span><strong className="num">{fmtGB(p.used_gb)}</strong> <span className="muted">used of ≈ {fmtGB(g.usable_gb)}</span></span>
              <span className="num muted">{pct !== null ? `${Math.round(pct * 100)}%` : ""}</span>
            </div>
            <Meter value={p.used_gb ?? 0} max={g.usable_gb} large label={`${p.name} used space`} />
            <Props items={[
              ["Raw capacity", fmtGB(g.raw_gb)],
              ["Usable (estimate)", `${fmtGB(g.usable_gb)} · ${Math.round(g.efficiency * 100)}% of raw`],
              ["Redundancy", g.data.length ? toleranceText(g.tolerance, p.layout) : "No data disks yet"],
            ]} />
          </div>
        </Section>
        <Section title={`Topology · ${g.vdevs.length} data vdev${g.vdevs.length === 1 ? "" : "s"}`}>
          {g.vdevs.length || auxRows.some(([, ds]) => ds.length) ? (
            <div className="topo">
              {g.vdevs.map((v) => (
                <div className="topo-vdev" key={v.name}>
                  <div className="topo-head">
                    <strong>{v.name.startsWith("disk-") ? "single disk" : v.name}</strong>
                    <span className="muted">{v.disks.length} × {fmtGB(Math.min(...v.disks.map((x) => x.capacity_gb)))} · {fmtGB(v.usable_gb)} usable</span>
                  </div>
                  <div className="disk-chips">{v.disks.map(chip)}</div>
                </div>
              ))}
              {auxRows.filter(([, ds]) => ds.length).map(([label, ds]) => (
                <div className="topo-vdev" key={label}>
                  <div className="topo-head"><strong style={{ fontFamily: "var(--font-sans)" }}>{label}</strong><span className="muted">{ds.length} × {fmtGB(Math.min(...ds.map((x) => x.capacity_gb)))}</span></div>
                  <div className="disk-chips">{ds.map(chip)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No disks yet. Open a disk and set its pool, or import <span className="mono">zpool status</span> from Tools.</div>
          )}
        </Section>
        <Section title={`Services · ${maps.length}`} action={null}>
          {maps.length ? (
            <ul className="link-list">
              {maps.map((m) => {
                const s = store.service(m.service_id);
                return (
                  <li key={m.id} className="row" style={{ flexWrap: "nowrap", gap: 0 }}>
                    <button className="link-row" onClick={() => s && store.open({ type: "service", id: s.id })}>
                      {s?.name ?? "Deleted service"}
                      {m.dataset && <span className="muted mono caption">{m.dataset}</span>}
                      <span className="meta">{m.access === "ro" ? "read only · " : ""}{fmtGB(m.used_gb)}</span>
                    </button>
                    <Button variant="ghost" size="sm" icon aria-label="Edit mapping" onClick={() => setMap(m)}><Pencil size={14} /></Button>
                  </li>
                );
              })}
            </ul>
          ) : <div className="muted">No service uses this pool yet.</div>}
        </Section>
        <Section title="Properties">
          <Props items={[
            ["Layout", LAYOUT_LABEL[p.layout] + (p.layout.startsWith("draid") ? ` · ${p.draid_data ?? "auto"} data · ${p.draid_spares} spare` : "")],
            ["Compression", p.compression], ["Record size", p.recordsize], ["ashift", p.ashift],
            ["Encryption", p.encryption ? "On" : "Off"], ["Dedup", p.dedup ? "On" : "Off"],
            ["Last scrub", p.last_scrub ? `${fmtDate(p.last_scrub)} (${fmtAgo(p.last_scrub)})` : "Never recorded"],
            ["Scrub target", `Every ${p.scrub_interval_days} days`],
            ["Last snapshot", p.last_snapshot ? `${fmtDate(p.last_snapshot)} (${fmtAgo(p.last_snapshot)})` : null],
            ["Purpose", p.purpose],
          ]} />
        </Section>
        {p.notes && <Section title="Notes"><div style={{ whiteSpace: "pre-wrap" }}>{p.notes}</div></Section>}
        <Section title="Commands">
          <div className="stack">
            <CodeBlock code={`zpool status -v ${p.name}\nzpool list -v ${p.name}\nzpool scrub ${p.name}`} />
            {g.vdevs.length > 0 && (
              <>
                <div className="caption muted">{p.status === "planned" ? "Create this pool:" : "Equivalent create command, for reference:"}</div>
                <CodeBlock code={createCommand(p, g)} />
              </>
            )}
          </div>
        </Section>
        <Section title="History"><EventsFor filter={(e) => e.pool_id === p.id} /></Section>
      </div>
      {edit && <EditDialog collection="pools" row={p} onClose={() => setEdit(false)} />}
      {map && <EditDialog collection="service_pools" row={map.id ? map : null} defaults={map} title={map.id ? "Edit pool mapping" : `Map a service to ${p.name}`} onClose={() => setMap(null)} />}
      {scrub && <ScrubDialog pool={p} onClose={() => setScrub(false)} />}
    </>
  );
}

function ScrubDialog({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const store = useStore();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  return (
    <Dialog
      title={`Scrub of ${pool.name} finished`}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => { if (await store.action(`/api/pools/${pool.id}/scrubbed`, { date, note }, "Scrub recorded.")) onClose(); }}>Record scrub</Button>
        </>
      }
    >
      <Field label="Finished on"><input className="cp-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Result" help="For example: repaired 0B with 0 errors."><input className="cp-input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Dialog>
  );
}

/* ---------------- Service ---------------- */

function ServiceDetail({ id }: { id: number }) {
  const store = useStore();
  const s = store.service(id);
  const [edit, setEdit] = useState(false);
  const [map, setMap] = useState<null | Record<string, any>>(null);
  const [del, setDel] = useState<number | null>(null);
  if (!s) return <Missing />;
  const host = store.server(s.server_id);
  const maps = store.state.service_pools.filter((m) => m.service_id === s.id);
  const pools = maps.map((m) => store.pool(m.pool_id)).filter((p): p is Pool => !!p);
  const disks = store.state.disks.filter((d) => pools.some((p) => p.id === d.pool_id));
  const servers = [...new Set(disks.map((d) => d.server_id).filter(Boolean) as number[])].map((x) => store.server(x)!).filter(Boolean);
  const weakest = pools.map((p) => ({ p, g: store.geometry(p) })).filter((x) => x.g.data.length).sort((a, b) => a.g.tolerance - b.g.tolerance)[0];

  return (
    <>
      <Head kicker={SVC_KIND[s.kind]} icon={<Boxes size={12} />} title={s.name}>
        <div className="row" style={{ marginTop: 6 }}>
          <Tag color={CRIT_COLOR[s.criticality]}>{s.criticality[0].toUpperCase() + s.criticality.slice(1)} criticality</Tag>
          <Tag color={s.status === "running" ? "green" : "gray"}>{s.status[0].toUpperCase() + s.status.slice(1)}</Tag>
        </div>
      </Head>
      <div className="drawer-body">
        <div className="drawer-actions">
          <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</Button>
          <Button size="sm" variant="outline" onClick={() => setMap({ service_id: s.id })}><Plus size={14} /> Map a pool</Button>
          {s.url && <a className="cp-btn cp-btn-outline cp-btn-sm" href={s.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>}
        </div>
        {weakest && (
          <div className={`cp-callout ${weakest.g.tolerance === 0 ? "cp-callout-warning" : "cp-callout-info"}`}>
            <Layers size={16} />
            <div>
              <div className="cp-callout-title">Storage path</div>
              {s.name} stores data on {pools.length} pool{pools.length === 1 ? "" : "s"} across {disks.length} disk{disks.length === 1 ? "" : "s"} in {servers.length} enclosure{servers.length === 1 ? "" : "s"}.
              {" "}The weakest is {weakest.p.name}: {toleranceText(weakest.g.tolerance, weakest.p.layout).toLowerCase()}.
            </div>
          </div>
        )}
        <Section title={`Pools and datasets · ${maps.length}`}>
          {maps.length ? (
            <ul className="link-list">
              {maps.map((m) => {
                const p = store.pool(m.pool_id);
                return (
                  <li key={m.id} className="row" style={{ flexWrap: "nowrap", gap: 0 }}>
                    <button className="link-row" onClick={() => p && store.open({ type: "pool", id: p.id })}>
                      <PoolSwatch pool={p} /> {p?.name}
                      {m.dataset && <span className="muted mono caption">{m.dataset}</span>}
                      <span className="meta">{m.access === "ro" ? "read only · " : ""}{fmtGB(m.used_gb)}</span>
                    </button>
                    <Button variant="ghost" size="sm" icon aria-label="Edit mapping" onClick={() => setMap(m)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="sm" icon aria-label="Remove mapping" onClick={() => setDel(m.id)}><Trash2 size={14} /></Button>
                  </li>
                );
              })}
            </ul>
          ) : <div className="muted">Map this service to the pools it stores data on.</div>}
        </Section>
        {servers.length > 0 && (
          <Section title="Disks live in">
            <ul className="link-list">
              {servers.map((x) => (
                <LinkRow key={x.id} to={{ type: "server", id: x.id }} meta={`${disks.filter((d) => d.server_id === x.id).length} disks`}>
                  <ServerIcon size={14} /> {x.name}
                </LinkRow>
              ))}
            </ul>
          </Section>
        )}
        <Section title="Details">
          <Props items={[
            ["Runs on", host ? <button className="pool-chip" onClick={() => store.open({ type: "server", id: host.id })}><ServerIcon size={14} />{host.name}</button> : null],
            ["URL", s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a> : null],
            ["IP address", s.ip ? <span className="mono">{s.ip}</span> : null],
            ["Backup policy", s.backup_policy],
            ["Description", s.description],
          ]} />
        </Section>
        {s.notes && <Section title="Notes"><div style={{ whiteSpace: "pre-wrap" }}>{s.notes}</div></Section>}
        <Section title="History"><EventsFor filter={(e) => e.service_id === s.id} /></Section>
      </div>
      {edit && <EditDialog collection="services" row={s} onClose={() => setEdit(false)} />}
      {map && <EditDialog collection="service_pools" row={map.id ? map : null} defaults={map} title={map.id ? "Edit pool mapping" : `Map a pool to ${s.name}`} onClose={() => setMap(null)} />}
      {del && (
        <Confirm title="Remove this mapping?" body="The service and the pool stay; only the link between them is removed." confirmLabel="Remove mapping"
          onClose={() => setDel(null)} onConfirm={() => store.remove("service_pools", del, "Mapping removed.")} />
      )}
    </>
  );
}
