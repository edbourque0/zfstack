import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { HardDrive, Plus, Search, Server as ServerIcon, Warehouse } from "lucide-react";
import { useStore } from "../store";
import type { Disk, Pool, Server } from "../types";
import { Button, Empty, Tabs } from "../components/ui";
import { BulkDiskDialog, EditDialog } from "../components/forms";
import { diskLabel, fmtGB, fmtHours } from "../lib/zfs";
import { KIND_LABEL } from "../components/details";

export type ColorMode = "pool" | "status" | "media" | "temp" | "age";
const U = 40;
const RACK_W = 760;

const ROLE_MARK: Record<Disk["role"], string> = { data: "", spare: "S", log: "L", special: "M", cache: "C", dedup: "D" };
const NEUTRAL = "#8a847e";

const STATUS_FILL: Record<Disk["status"], [string, string]> = {
  online: ["var(--st-good)", "#fff"],
  degraded: ["var(--st-warning)", "#0b0b0b"],
  faulted: ["var(--st-critical)", "#fff"],
  failed: ["var(--st-critical)", "#fff"],
  testing: ["var(--seq-4)", "#fff"],
  available: [NEUTRAL, "#fff"],
  retired: [NEUTRAL, "#fff"],
};
const MEDIA_FILL: Record<Disk["media"], number> = { hdd: 0, ssd: 1, nvme: 2 };

function seq(step: number): [string, string] {
  const s = Math.max(1, Math.min(7, step));
  return [`var(--seq-${s})`, s <= 3 ? "#0b0b0b" : "#fff"];
}

export function diskFill(d: Disk, mode: ColorMode, pool: Pool | undefined, poolColor: number | null): [string, string] {
  switch (mode) {
    case "pool":
      return pool && poolColor !== null ? [`var(--pool-${poolColor})`, `var(--pool-ink-${poolColor})`] : [NEUTRAL, "#fff"];
    case "status":
      return STATUS_FILL[d.status];
    case "media": {
      const c = MEDIA_FILL[d.media];
      return [`var(--pool-${c})`, `var(--pool-ink-${c})`];
    }
    case "temp":
      if (d.temperature_c === null) return [NEUTRAL, "#fff"];
      return seq(Math.floor((d.temperature_c - 20) / 5));
    case "age":
      if (d.power_on_hours === null) return [NEUTRAL, "#fff"];
      return seq(Math.floor(d.power_on_hours / 8766) + 1);
  }
}

function alertLevel(d: Disk): "critical" | "warning" | null {
  if (["faulted", "failed"].includes(d.status) || d.smart_status === "failed" || (d.temperature_c ?? 0) >= 55) return "critical";
  if (d.status === "degraded" || d.smart_status === "warning" || (d.temperature_c ?? 0) >= 50) return "warning";
  return null;
}

interface FaceProps {
  server: Server;
  mode: ColorMode;
  compact?: boolean;
  highlight?: (d: Disk) => boolean;
  onEmptyBay?: (server: Server, bay: number) => void;
  onHover?: (d: Disk | null, e?: React.MouseEvent) => void;
}

export function ServerFace({ server, mode, compact, highlight, onEmptyBay, onHover }: FaceProps) {
  const store = useStore();
  const [dropBay, setDropBay] = useState<number | null>(null);
  const byBay = useMemo(() => {
    const m = new Map<number, Disk>();
    for (const d of store.state.disks) if (d.server_id === server.id && d.bay !== null) m.set(d.bay, d);
    return m;
  }, [store.state.disks, server.id]);

  const rows = Math.max(1, server.bay_rows);
  const cols = Math.max(1, Math.ceil(server.bay_count / rows));
  const bayAreaW = compact ? 460 : RACK_W - 8 - 112 - 24;
  const cellH = (server.height_u * (compact ? 30 : U) - 10) / rows;
  const vertical = cellH > bayAreaW / cols;
  const selected = store.detail?.type === "disk" ? store.detail.id : null;
  const serverSel = store.detail?.type === "server" && store.detail.id === server.id;

  const drop = (bay: number) => async (e: DragEvent) => {
    e.preventDefault();
    setDropBay(null);
    const id = Number(e.dataTransfer.getData("text/zfstack-disk"));
    if (!id) return;
    const d = store.disk(id);
    if (d && d.server_id === server.id && d.bay === bay) return;
    const target = byBay.get(bay);
    await store.action(`/api/disks/${id}/move`, { server_id: server.id, bay }, target ? `Swapped with ${target.serial}.` : `Moved to ${server.name} bay ${bay}.`);
  };

  const led = server.status === "active" ? "" : server.status === "maintenance" ? "warn" : "off";

  return (
    <div className={`face ${serverSel ? "face-sel" : ""}`} style={compact ? { gridTemplateColumns: "1fr", padding: 5 } : undefined}>
      {!compact && (
        <button className="face-label" onClick={() => store.open({ type: "server", id: server.id })} title={`Open ${server.name}`}>
          <span className="face-name"><span className={`face-led ${led}`} aria-hidden />{server.name}</span>
          <span className="face-model">{server.model || KIND_LABEL[server.kind]}</span>
        </button>
      )}
      {server.bay_count > 0 ? (
        <div className="bays" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {Array.from({ length: server.bay_count }, (_, bay) => {
            const d = byBay.get(bay);
            const orient = vertical ? "bay-v" : "bay-h";
            const common = {
              onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes("text/zfstack-disk")) { e.preventDefault(); setDropBay(bay); } },
              onDragLeave: () => setDropBay((b) => (b === bay ? null : b)),
              onDrop: drop(bay),
            };
            if (!d) {
              return (
                <button
                  key={bay}
                  className={`bay bay-empty ${orient} ${dropBay === bay ? "drop" : ""}`}
                  aria-label={`${server.name} bay ${bay}, empty`}
                  title={`Bay ${bay} · empty`}
                  onClick={() => onEmptyBay?.(server, bay)}
                  {...common}
                >
                  {!compact && cols <= 30 && <span className="bay-num" style={{ color: "var(--rack-muted)" }}>{bay}</span>}
                  <Plus size={12} />
                </button>
              );
            }
            const pool = store.pool(d.pool_id);
            const [bg, ink] = diskFill(d, mode, pool, store.poolColor(pool));
            const lvl = alertLevel(d);
            const dim = highlight ? !highlight(d) : false;
            const style: CSSProperties = { background: bg, color: ink };
            return (
              <button
                key={bay}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/zfstack-disk", String(d.id)); e.dataTransfer.effectAllowed = "move"; onHover?.(null); }}
                className={`bay bay-disk ${orient} ${d.role === "spare" || (!d.pool_id && mode === "pool") ? "bay-hatch" : ""} ${selected === d.id ? "bay-sel" : ""} ${dim ? "bay-dim" : ""} ${dropBay === bay ? "drop" : ""}`}
                style={style}
                aria-label={`${server.name} bay ${bay}: ${d.serial}, ${fmtGB(d.capacity_gb)}, ${pool ? `pool ${pool.name}` : "no pool"}, ${d.status}`}
                onClick={() => store.open({ type: "disk", id: d.id })}
                onMouseEnter={(e) => onHover?.(d, e)}
                onMouseMove={(e) => onHover?.(d, e)}
                onMouseLeave={() => onHover?.(null)}
                {...common}
              >
                {!compact && cols <= 30 && <span className="bay-num">{bay}</span>}
                {d.status === "online" && !compact && <span className="bay-led" aria-hidden />}
                {ROLE_MARK[d.role] && <span className="bay-mark">{ROLE_MARK[d.role]}</span>}
                {lvl && <span className={`bay-alert ${lvl === "warning" ? "warn" : ""}`} aria-hidden><span style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}>!</span></span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="face-vents" />
      )}
    </div>
  );
}

function Tooltip({ d, x, y }: { d: Disk; x: number; y: number }) {
  const store = useStore();
  const pool = store.pool(d.pool_id);
  const left = Math.min(x + 14, window.innerWidth - 300);
  const top = Math.min(y + 14, window.innerHeight - 160);
  return (
    <div className="tooltip" style={{ left, top }}>
      <strong className="mono">{d.serial}</strong>
      <div>{diskLabel(d)} · {fmtGB(d.capacity_gb)} {d.media.toUpperCase()}</div>
      <div>Pool: {pool ? `${pool.name}${d.vdev ? ` · ${d.vdev}` : ""}${d.role !== "data" ? ` · ${d.role}` : ""}` : "none"}</div>
      <div>Status: {d.status} · SMART {d.smart_status}</div>
      {(d.temperature_c !== null || d.power_on_hours !== null) && (
        <div>{d.temperature_c !== null ? `${d.temperature_c} °C` : ""}{d.temperature_c !== null && d.power_on_hours !== null ? " · " : ""}{d.power_on_hours !== null ? `${fmtHours(d.power_on_hours)} powered on` : ""}</div>
      )}
    </div>
  );
}

function Legend({ mode, focus, setFocus }: { mode: ColorMode; focus: number | null; setFocus: (n: number | null) => void }) {
  const store = useStore();
  const placed = store.state.disks.filter((d) => d.server_id !== null && d.bay !== null);
  const item = (key: string, color: string, label: ReactNode, count: number, extra?: { hatch?: boolean; onClick?: () => void; on?: boolean }) => {
    const Comp = extra?.onClick ? "button" : "div";
    return (
      <Comp key={key} className={`legend-item ${extra?.on ? "on" : ""}`} onClick={extra?.onClick}>
        <span className={`legend-swatch ${extra?.hatch ? "bay-hatch" : ""}`} style={{ background: color }} />
        <span>{label}</span>
        <span className="count">{count}</span>
      </Comp>
    );
  };
  let items: ReactNode[] = [];
  if (mode === "pool") {
    items = store.state.pools.filter((p) => placed.some((d) => d.pool_id === p.id)).map((p) => {
      const c = store.poolColor(p);
      return item(`p${p.id}`, c === null ? NEUTRAL : `var(--pool-${c})`, p.name, placed.filter((d) => d.pool_id === p.id).length, {
        onClick: () => setFocus(focus === p.id ? null : p.id), on: focus === p.id,
      });
    });
    items.push(item("none", NEUTRAL, "Not in a pool", placed.filter((d) => !d.pool_id).length, { hatch: true }));
  } else if (mode === "status") {
    const words: [Disk["status"], string][] = [["online", "Online"], ["degraded", "Degraded"], ["faulted", "Faulted"], ["failed", "Failed"], ["testing", "Testing"], ["available", "Available"], ["retired", "Retired"]];
    items = words.map(([s, w]) => item(s, STATUS_FILL[s][0], w, placed.filter((d) => d.status === s).length)).filter((_, i) => placed.some((d) => d.status === words[i][0]));
  } else if (mode === "media") {
    items = (["hdd", "ssd", "nvme"] as const).map((m) => item(m, `var(--pool-${MEDIA_FILL[m]})`, m.toUpperCase(), placed.filter((d) => d.media === m).length));
  } else if (mode === "temp") {
    items = ["Under 30 °C", "30–34 °C", "35–39 °C", "40–44 °C", "45–49 °C", "50–54 °C", "55 °C and over"].map((l, i) =>
      item(`t${i}`, `var(--seq-${i + 1})`, l, placed.filter((d) => d.temperature_c !== null && Math.max(1, Math.min(7, Math.floor((d.temperature_c - 20) / 5))) === i + 1).length));
    items.push(item("tn", NEUTRAL, "Unknown", placed.filter((d) => d.temperature_c === null).length));
  } else {
    items = ["Under 1 year", "1–2 years", "2–3 years", "3–4 years", "4–5 years", "5–6 years", "6 years and over"].map((l, i) =>
      item(`a${i}`, `var(--seq-${i + 1})`, l, placed.filter((d) => d.power_on_hours !== null && Math.max(1, Math.min(7, Math.floor(d.power_on_hours / 8766) + 1)) === i + 1).length));
    items.push(item("an", NEUTRAL, "Unknown", placed.filter((d) => d.power_on_hours === null).length));
  }
  return (
    <div className="cp-card" style={{ padding: 16, gap: 8 }}>
      <div className="sub-title" style={{ margin: 0 }}>Legend</div>
      <div className="legend">{items}</div>
      <div className="caption muted" style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 4 }}>
        <span><span className="mono">S</span> hot spare · <span className="mono">L</span> SLOG · <span className="mono">M</span> special · <span className="mono">C</span> cache · <span className="mono">D</span> dedup</span>
        <span>Hatched: hot spare or not in a pool. <strong style={{ color: "var(--destructive)" }}>!</strong> needs attention.</span>
        {mode === "pool" && <span>Click a pool to highlight its disks.</span>}
      </div>
    </div>
  );
}

export default function RackView() {
  const store = useStore();
  const { state } = store;
  const [mode, setMode] = useState<ColorMode>("pool");
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<{ d: Disk; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "rack" } | { kind: "server"; defaults?: Record<string, unknown> } | { kind: "disk"; defaults: Record<string, unknown> } | { kind: "bulk" }>(null);
  const [looseDrop, setLooseDrop] = useState(false);

  const query = q.trim().toLowerCase();
  const highlight = query || focus !== null
    ? (d: Disk) =>
        (focus === null || d.pool_id === focus) &&
        (!query || [d.serial, d.model, d.vendor, store.pool(d.pool_id)?.name, d.vdev].some((x) => x?.toLowerCase().includes(query)))
    : undefined;

  const onHover = (d: Disk | null, e?: React.MouseEvent) => setHover(d && e ? { d, x: e.clientX, y: e.clientY } : null);
  const onEmptyBay = (server: Server, bay: number) => setDialog({ kind: "disk", defaults: { server_id: server.id, bay } });
  const unracked = state.servers.filter((s) => !s.rack_id || !s.rack_u || !state.racks.some((r) => r.id === s.rack_id));
  const loose = state.disks.filter((d) => (d.server_id === null || d.bay === null) && !["retired", "failed"].includes(d.status));

  if (!state.racks.length && !state.servers.length) {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">Rack</h1><p className="page-sub">A front view of every enclosure and the disk in each bay.</p></div></div>
        <Empty icon={<Warehouse size={28} />} title="Your rack is empty" action={
          <div className="row" style={{ justifyContent: "center" }}>
            <Button onClick={() => setDialog({ kind: "rack" })}><Plus size={16} /> Create rack</Button>
            <Button variant="outline" onClick={() => setDialog({ kind: "server" })}>Add server</Button>
          </div>
        }>
          Create a rack, then add servers and disk shelves with their bay count. Every bay becomes a place for a disk.
        </Empty>
        {dialog?.kind === "rack" && <EditDialog collection="racks" onClose={() => setDialog(null)} />}
        {dialog?.kind === "server" && <EditDialog collection="servers" onClose={() => setDialog(null)} />}
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: "none" }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Rack</h1>
          <p className="page-sub">Click a disk for details. Drag disks between bays to move or swap them.</p>
        </div>
        <div className="row">
          <Button variant="outline" onClick={() => setDialog({ kind: "rack" })}><Plus size={16} /> Rack</Button>
          <Button onClick={() => setDialog({ kind: "server", defaults: state.racks[0] ? { rack_id: state.racks[0].id } : undefined })}><Plus size={16} /> Server</Button>
        </div>
      </div>

      <div className="rack-toolbar">
        <Tabs<ColorMode>
          value={mode}
          onChange={(m) => { setMode(m); setFocus(null); }}
          items={[
            { value: "pool", label: "Pool" },
            { value: "status", label: "Status" },
            { value: "media", label: "Media" },
            { value: "temp", label: "Temperature" },
            { value: "age", label: "Age" },
          ]}
        />
        <div className="cp-input-wrap" style={{ width: 260 }}>
          <Search size={16} />
          <input className="cp-input" placeholder="Find serial, model or pool" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Highlight disks" />
        </div>
      </div>

      <div className="rack-layout">
        <div className="stack" style={{ gap: 24, minWidth: 0 }}>
          <div className="racks">
            {state.racks.map((r) => {
              const items = state.servers.filter((s) => s.rack_id === r.id && s.rack_u);
              const used = items.reduce((a, s) => a + s.height_u, 0);
              const watts = items.reduce((a, s) => a + (s.power_watts ?? 0), 0);
              return (
                <div className="rack" key={r.id}>
                  <div className="rack-name">
                    {r.name}
                    <span className="muted caption" style={{ fontWeight: 400 }}>{used} of {r.height_u}U used{watts ? ` · ${watts} W` : ""}</span>
                    <span className="spacer" />
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "server", defaults: { rack_id: r.id } })}><Plus size={14} /> Server</Button>
                    <RackEdit rackId={r.id} />
                  </div>
                  <div className="rack-frame" style={{ ["--rack-w" as any]: `${RACK_W}px`, ["--u" as any]: `${U}px` }}>
                    <div className="rack-rail">{Array.from({ length: r.height_u }, (_, i) => <div className="rack-u" key={i}>{r.height_u - i}</div>)}</div>
                    <div className="rack-slots" style={{ height: r.height_u * U }}>
                      {Array.from({ length: r.height_u }, (_, i) => <div className="rack-empty-u" key={i} style={{ top: i * U, height: U }} />)}
                      {items.map((s) => {
                        const top = (r.height_u - (s.rack_u! + s.height_u - 1)) * U;
                        return (
                          <div className="rack-item" key={s.id} style={{ top: top + 2, height: s.height_u * U - 4 }}>
                            <ServerFace server={s} mode={mode} highlight={highlight} onEmptyBay={onEmptyBay} onHover={onHover} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="rack-rail">{Array.from({ length: r.height_u }, (_, i) => <div className="rack-u" key={i}>{r.height_u - i}</div>)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {unracked.length > 0 && (
            <div className="stack">
              <div className="section-title">Not in a rack</div>
              <div className="stack" style={{ maxWidth: RACK_W + 60, overflowX: "auto" }}>
                {unracked.map((s) => (
                  <div key={s.id} style={{ height: Math.max(1, s.height_u) * U, minWidth: 560, background: "var(--rack-frame)", padding: 2, borderRadius: 6 }}>
                    <ServerFace server={s} mode={mode} highlight={highlight} onEmptyBay={onEmptyBay} onHover={onHover} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack" style={{ position: "sticky", top: 68 }}>
          <Legend mode={mode} focus={focus} setFocus={setFocus} />
          <div
            className="cp-card"
            style={{ padding: 16, gap: 10, outline: looseDrop ? "2px solid var(--ring)" : undefined }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("text/zfstack-disk")) { e.preventDefault(); setLooseDrop(true); } }}
            onDragLeave={() => setLooseDrop(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setLooseDrop(false);
              const id = Number(e.dataTransfer.getData("text/zfstack-disk"));
              if (id) await store.action(`/api/disks/${id}/move`, { server_id: null, bay: null }, "Disk moved to the shelf.");
            }}
          >
            <div className="row">
              <span className="sub-title" style={{ margin: 0 }}>Shelf · {loose.length}</span>
              <span className="spacer" />
              <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "disk", defaults: {} })}><Plus size={14} /> Disk</Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "bulk" })}>Bulk</Button>
            </div>
            {loose.length ? (
              <div className="loose">
                {loose.map((d) => (
                  <button
                    key={d.id}
                    className="loose-disk"
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/zfstack-disk", String(d.id)); e.dataTransfer.effectAllowed = "move"; }}
                    onClick={() => store.open({ type: "disk", id: d.id })}
                    title={`${diskLabel(d)} · ${fmtGB(d.capacity_gb)}. Drag onto an empty bay.`}
                  >
                    <HardDrive size={12} />{d.serial}<span className="muted">{fmtGB(d.capacity_gb)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="caption muted">Disks without a bay appear here. Drag a disk here to take it out of its bay.</div>
            )}
          </div>
          {state.servers.length > 0 && (
            <div className="caption muted row" style={{ gap: 6 }}>
              <ServerIcon size={12} /> {state.servers.length} enclosures · {state.servers.reduce((a, s) => a + s.bay_count, 0)} bays · {state.disks.filter((d) => d.bay !== null).length} filled
            </div>
          )}
        </div>
      </div>

      {hover && <Tooltip d={hover.d} x={hover.x} y={hover.y} />}
      {dialog?.kind === "rack" && <EditDialog collection="racks" onClose={() => setDialog(null)} />}
      {dialog?.kind === "server" && <EditDialog collection="servers" defaults={dialog.defaults} onClose={() => setDialog(null)} />}
      {dialog?.kind === "disk" && <EditDialog collection="disks" defaults={dialog.defaults} onClose={() => setDialog(null)} />}
      {dialog?.kind === "bulk" && <BulkDiskDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function RackEdit({ rackId }: { rackId: number }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const r = state.racks.find((x) => x.id === rackId);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Edit</Button>
      {open && r && <EditDialog collection="racks" row={r} onClose={() => setOpen(false)} />}
    </>
  );
}
