import { useState } from "react";
import { Calculator, CloudDownload, FileInput } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import type { Layout } from "../types";
import { Button, Field, Tabs, Tag } from "../components/ui";
import { LAYOUT_LABEL, fmtGB, parity, vdevTolerance, vdevUsable } from "../lib/zfs";
import { TruenasImport } from "./TruenasImport";

type ToolTab = "planner" | "truenas" | "import";

export default function ToolsView({ sub, go }: { sub?: string; go: (r: string) => void }) {
  const tab: ToolTab = sub === "truenas" || sub === "import" ? sub : "planner";
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Tools</h1>
          <p className="page-sub">Plan a pool before buying disks, or import pools from TrueNAS or <span className="mono">zpool status</span>.</p>
        </div>
      </div>
      <Tabs<ToolTab> value={tab} onChange={(t) => go(t === "planner" ? "tools" : `tools/${t}`)} items={[
        { value: "planner", label: <><Calculator size={14} /> Capacity planner</> },
        { value: "truenas", label: <><CloudDownload size={14} /> Import from TrueNAS</> },
        { value: "import", label: <><FileInput size={14} /> Import zpool status</> },
      ]} />
      {tab === "planner" ? <Planner /> : tab === "truenas" ? <TruenasImport /> : <ZpoolImport />}
    </div>
  );
}

/* ---------------- Planner ---------------- */

const LAYOUTS: Layout[] = ["stripe", "mirror", "raidz1", "raidz2", "raidz3", "draid1", "draid2", "draid3"];
const SLOP = 1 - 1 / 32;

function plan(layout: Layout, vdevs: number, width: number, sizeGB: number, spares: number) {
  const draid = layout.startsWith("draid");
  const n = draid ? width : width;
  const perVdev = layout === "stripe" ? sizeGB * n : vdevUsable(layout, n, sizeGB, sizeGB * n, { data: null, spares: draid ? spares : 0 });
  const usable = perVdev * vdevs * SLOP;
  const raw = sizeGB * n * vdevs;
  const tol = layout === "stripe" ? 0 : vdevTolerance(layout, n);
  const minWidth = layout === "mirror" ? 2 : layout === "stripe" ? 1 : draid ? parity(layout) + 2 + spares : parity(layout) + 2;
  return { usable, raw, tol, valid: n >= minWidth, minWidth, disks: n * vdevs, eff: raw ? usable / raw : 0 };
}

function Planner() {
  const { state } = useStore();
  const [layout, setLayout] = useState<Layout>("raidz2");
  const [vdevs, setVdevs] = useState(1);
  const [width, setWidth] = useState(6);
  const [size, setSize] = useState(8000);
  const [spares, setSpares] = useState(1);
  const [price, setPrice] = useState(0);
  const [fill, setFill] = useState(80);
  const r = plan(layout, vdevs, width, size, spares);
  const total = r.disks;
  const spareDisks = state.disks.filter((d) => d.status === "available" && !d.pool_id && d.capacity_gb >= size).length;
  const iopsNote = layout === "mirror" ? `About ${vdevs * width}× one disk for reads and ${vdevs}× for writes.` : `Random IOPS of about ${vdevs} disk${vdevs === 1 ? "" : "s"} (one per vdev).`;

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <section className="cp-card">
        <div className="cp-card-title">Pool shape</div>
        <div className="form-grid">
          <Field label="Layout">
            <select className="cp-select" value={layout} onChange={(e) => setLayout(e.target.value as Layout)}>
              {LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
            </select>
          </Field>
          <Field label="Disk size (GB)" help="Vendor size: 8 TB is 8000.">
            <input className="cp-input" type="number" min={1} value={size} onChange={(e) => setSize(Number(e.target.value) || 0)} />
          </Field>
          <Field label={layout.startsWith("draid") ? "Children (disks)" : "Disks per vdev"} help={r.valid ? undefined : `${LAYOUT_LABEL[layout]} needs at least ${r.minWidth}.`}>
            <input className="cp-input" type="number" min={1} value={width} onChange={(e) => setWidth(Number(e.target.value) || 1)} />
          </Field>
          <Field label={layout.startsWith("draid") ? "dRAID vdevs" : "Number of vdevs"}>
            <input className="cp-input" type="number" min={1} value={vdevs} onChange={(e) => setVdevs(Number(e.target.value) || 1)} />
          </Field>
          {layout.startsWith("draid") && (
            <Field label="Distributed spares">
              <input className="cp-input" type="number" min={0} value={spares} onChange={(e) => setSpares(Number(e.target.value) || 0)} />
            </Field>
          )}
          <Field label="Price per disk" help="Optional, for cost per usable TB.">
            <input className="cp-input" type="number" min={0} step="0.01" value={price || ""} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Target fill (%)" help="Keep pools under 80% for good performance.">
            <input className="cp-input" type="number" min={1} max={100} value={fill} onChange={(e) => setFill(Number(e.target.value) || 80)} />
          </Field>
        </div>
      </section>
      <section className="cp-card">
        <div className="cp-card-title">Result</div>
        <div className="planner-out">
          <div className="kpi"><span className="kpi-label">Usable</span><span className="kpi-value">{r.valid ? fmtGB(r.usable) : "—"}</span><span className="kpi-sub">{fmtGB((r.usable * fill) / 100)} at {fill}% fill</span></div>
          <div className="kpi"><span className="kpi-label">Raw</span><span className="kpi-value">{fmtGB(r.raw)}</span><span className="kpi-sub">{total} disks · {Math.round(r.eff * 100)}% efficient</span></div>
          <div className="kpi"><span className="kpi-label">Survives</span><span className="kpi-value">{r.tol}</span><span className="kpi-sub">disk failure{r.tol === 1 ? "" : "s"}{layout !== "stripe" && !layout.startsWith("draid") && vdevs > 1 ? " per vdev" : ""}</span></div>
          {price > 0 && <div className="kpi"><span className="kpi-label">Cost</span><span className="kpi-value">{(price * total).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</span><span className="kpi-sub">{r.usable ? `${(price * total / (r.usable / 1000)).toFixed(2)} per usable TB` : ""}</span></div>}
        </div>
        <div className="caption muted" style={{ display: "grid", gap: 4 }}>
          <span>{iopsNote}</span>
          <span>Estimates in vendor TB after ZFS slop space; real numbers vary with record size, ashift and compression.</span>
          <span>{spareDisks ? `You have ${spareDisks} unused disk${spareDisks === 1 ? "" : "s"} of this size or larger.` : "You have no unused disk of this size yet."}</span>
        </div>
      </section>
      <section className="cp-card" style={{ gridColumn: "1 / -1" }}>
        <div className="cp-card-title">Same {total} disks, other layouts</div>
        <div className="cp-db-scroll">
          <table className="cp-db-table compare">
            <thead><tr><th>Layout</th><th>Shape</th><th className="r">Usable</th><th className="r">Efficiency</th><th className="r">Survives</th></tr></thead>
            <tbody>
              {(() => {
                const opts: { l: Layout; v: number; w: number }[] = [];
                if (total >= 2 && total % 2 === 0) opts.push({ l: "mirror", v: total / 2, w: 2 });
                if (total >= 3 && total % 3 === 0) opts.push({ l: "mirror", v: total / 3, w: 3 });
                for (const l of ["raidz1", "raidz2", "raidz3"] as Layout[]) {
                  for (const w of [4, 5, 6, 7, 8, 9, 10, 11, 12]) if (total % w === 0 && w >= parity(l) + 2) opts.push({ l, v: total / w, w });
                }
                if (total >= 6) opts.push({ l: "draid2", v: 1, w: total });
                return opts.map((o, i) => {
                  const x = plan(o.l, o.v, o.w, size, o.l.startsWith("draid") ? 1 : 0);
                  const current = o.l === layout && o.v === vdevs && o.w === width;
                  return (
                    <tr key={i} style={{ cursor: "pointer" }} onClick={() => { setLayout(o.l); setVdevs(o.v); setWidth(o.w); }}>
                      <td>{LAYOUT_LABEL[o.l]} {current && <Tag color="violet">Current</Tag>}</td>
                      <td className="muted">{o.l.startsWith("draid") ? `${o.w} children, 1 spare` : `${o.v} × ${o.w}-wide`}</td>
                      <td className="r">{fmtGB(x.usable)}</td>
                      <td className="r">{Math.round(x.eff * 100)}%</td>
                      <td className="r">{x.tol}{o.v > 1 && !o.l.startsWith("draid") ? " per vdev" : ""}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
        <div className="caption muted">Click a row to load it above.</div>
      </section>
    </div>
  );
}

/* ---------------- zpool import ---------------- */

interface PlanPool {
  name: string; layout: string; state: string; last_scrub: string | null; pool_id: number | null; action: "update" | "create";
  devices: { device: string; serial: string; disk_id: number | null; action: "link" | "create"; vdev: string | null; role: string; status: string }[];
}

function ZpoolImport() {
  const store = useStore();
  const servers = store.state.servers;
  const [server, setServer] = useState(() => { const s = servers.find((x) => x.kind === "server" || x.kind === "nas") ?? servers[0]; return s ? String(s.id) : ""; });
  const [text, setText] = useState("");
  const [cap, setCap] = useState(4000);
  const [preview, setPreview] = useState<PlanPool[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const doPreview = async () => {
    setErr(null);
    try { setPreview(await api.post<PlanPool[]>("/api/zpool/preview", { text, server_id: Number(server) })); }
    catch (e: any) { setErr(e.message); setPreview(null); }
  };
  const apply = async () => {
    const r = await store.action<{ pools: number; linked: number; created: number }>("/api/zpool/apply", { text, server_id: Number(server), capacity_gb: cap });
    if (r) { store.toast(`Imported ${r.pools} pool${r.pools === 1 ? "" : "s"}: ${r.linked} disks linked, ${r.created} created.`); setPreview(null); setText(""); }
  };
  const newDisks = preview?.reduce((a, p) => a + p.devices.filter((d) => d.action === "create").length, 0) ?? 0;

  if (!servers.length) return <div className="cp-callout cp-callout-info"><FileInput size={16} /><div>Add the server that runs the pools first, then come back to import them.</div></div>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="cp-card">
        <div className="cp-card-desc">
          Run <span className="mono">zpool status</span> on the host and paste the output. Disks are matched by serial number or WWN inside device names such as
          {" "}<span className="mono">ata-WDC_WD80EFAX_VAG12345</span>. Use <span className="mono">/dev/disk/by-id</span> names for the best match.
        </div>
        <div className="form-grid">
          <Field label="Host">
            <select className="cp-select" value={server} onChange={(e) => { setServer(e.target.value); setPreview(null); }}>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Size for new disks (GB)" help="Disks not found in ZFStack are created with this size. Fix it per disk later.">
            <input className="cp-input" type="number" min={1} value={cap} onChange={(e) => setCap(Number(e.target.value) || 1)} />
          </Field>
          <Field label="zpool status output" full>
            <textarea className="cp-textarea mono" rows={12} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={"  pool: tank\n state: ONLINE\nconfig:\n\n\tNAME        STATE     READ WRITE CKSUM\n\ttank        ONLINE       0     0     0\n\t  raidz2-0  ONLINE       0     0     0\n\t    ata-…   ONLINE       0     0     0"} />
          </Field>
        </div>
        <div className="row">
          <Button variant="outline" disabled={!text.trim()} onClick={doPreview}>Preview</Button>
          {preview && <Button onClick={apply}>Import {preview.length} pool{preview.length === 1 ? "" : "s"}</Button>}
          {err && <span className="status status-critical">{err}</span>}
        </div>
      </section>
      {preview && (
        <section className="cp-card">
          <div className="cp-card-title">Preview</div>
          {newDisks > 0 && <div className="caption muted">{newDisks} device{newDisks === 1 ? " is" : "s are"} not in ZFStack yet and will be created without a bay.</div>}
          {preview.map((p) => (
            <div key={p.name} className="stack" style={{ gap: 8 }}>
              <div className="row">
                <strong className="mono">{p.name}</strong>
                <Tag color={p.action === "create" ? "green" : "blue"}>{p.action === "create" ? "New pool" : "Update existing"}</Tag>
                <span className="muted">{LAYOUT_LABEL[p.layout as Layout] ?? p.layout} · {p.state}{p.last_scrub ? ` · scrubbed ${p.last_scrub}` : ""}</span>
              </div>
              <div className="cp-db-scroll">
                <table className="cp-db-table">
                  <thead><tr><th>Device</th><th>Serial</th><th>Vdev</th><th>Role</th><th>State</th><th>Action</th></tr></thead>
                  <tbody>
                    {p.devices.map((d) => (
                      <tr key={d.device} style={{ cursor: "default" }}>
                        <td className="mono caption">{d.device}</td>
                        <td className="mono">{d.serial}</td>
                        <td className="mono muted">{d.vdev ?? "—"}</td>
                        <td>{d.role}</td>
                        <td>{d.status}</td>
                        <td>{d.action === "link" ? <Tag color="blue">Link</Tag> : <Tag color="green">Create</Tag>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
