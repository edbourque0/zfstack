import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  AlertTriangle, Check, CheckCircle2, CircleDashed, CircleSlash, Copy, HelpCircle, Info, Loader, OctagonX, X, XCircle,
} from "lucide-react";
import type { Disk, Pool } from "../types";
import { useStore } from "../store";

/* ---------- Button ---------- */
type BtnVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export function Button({
  variant = "default", size, icon, className = "", children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm"; icon?: boolean }) {
  return (
    <button
      type="button"
      className={`cp-btn cp-btn-${variant} ${size === "sm" ? "cp-btn-sm" : ""} ${icon ? "cp-btn-icon" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Status ---------- */
type Tone = "good" | "warning" | "critical" | "muted" | "ribbon";
const ICON: Record<Tone, ReactNode> = {
  good: <CheckCircle2 size={14} />,
  warning: <AlertTriangle size={14} />,
  critical: <XCircle size={14} />,
  muted: <CircleDashed size={14} />,
  ribbon: <Loader size={14} />,
};
export function Status({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      {icon ?? ICON[tone]}
      {children}
    </span>
  );
}

const DISK_TONE: Record<Disk["status"], Tone> = {
  online: "good", degraded: "warning", faulted: "critical", failed: "critical", available: "muted", testing: "ribbon", retired: "muted",
};
const DISK_WORD: Record<Disk["status"], string> = {
  online: "Online", degraded: "Degraded", faulted: "Faulted", failed: "Failed", available: "Available", testing: "Testing", retired: "Retired",
};
export const DiskStatus = ({ d }: { d: Disk }) => (
  <Status tone={DISK_TONE[d.status]} icon={d.status === "retired" ? <CircleSlash size={14} /> : undefined}>{DISK_WORD[d.status]}</Status>
);

const SMART_TONE = { passed: "good", warning: "warning", failed: "critical", unknown: "muted" } as const;
const SMART_WORD = { passed: "Passed", warning: "Warning", failed: "Failed", unknown: "Unknown" };
export const SmartStatus = ({ d }: { d: Disk }) => (
  <Status tone={SMART_TONE[d.smart_status]} icon={d.smart_status === "unknown" ? <HelpCircle size={14} /> : undefined}>
    {SMART_WORD[d.smart_status]}
  </Status>
);

const POOL_TONE: Record<Pool["status"], Tone> = {
  online: "good", degraded: "warning", faulted: "critical", offline: "critical", migrating: "ribbon", planned: "muted", retired: "muted",
};
const POOL_WORD: Record<Pool["status"], string> = {
  online: "Online", degraded: "Degraded", faulted: "Faulted", offline: "Offline", migrating: "Migrating", planned: "Planned", retired: "Retired",
};
export const PoolStatus = ({ p }: { p: Pool }) => <Status tone={POOL_TONE[p.status]}>{POOL_WORD[p.status]}</Status>;

export function SeverityIcon({ s }: { s: "critical" | "warning" | "info" }) {
  if (s === "critical") return <OctagonX size={16} aria-label="Critical" />;
  if (s === "warning") return <AlertTriangle size={16} aria-label="Warning" />;
  return <Info size={16} aria-label="Info" />;
}

/* ---------- Tags ---------- */
export type TagColor = "gray" | "amber" | "green" | "blue" | "rose" | "violet";
export const Tag = ({ color = "gray", children }: { color?: TagColor; children: ReactNode }) => (
  <span className={`cp-tag cp-tag-${color}`}>{children}</span>
);

export function PoolSwatch({ pool, size = 10 }: { pool: Pool | undefined; size?: number }) {
  const { poolColor } = useStore();
  const c = poolColor(pool);
  return (
    <span
      className="swatch"
      style={{ width: size, height: size, background: c === null ? "var(--muted-foreground)" : `var(--pool-${c})` }}
      aria-hidden
    />
  );
}

export function PoolChip({ pool }: { pool: Pool | undefined }) {
  const { open } = useStore();
  if (!pool) return <span className="muted">—</span>;
  return (
    <button className="pool-chip" onClick={(e) => { e.stopPropagation(); open({ type: "pool", id: pool.id }); }}>
      <PoolSwatch pool={pool} />
      {pool.name}
    </button>
  );
}

/* ---------- Form fields ---------- */
export function Field({ label, help, children, full }: { label: string; help?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`cp-switch ${checked ? "cp-switch-on" : ""}`} onClick={() => onChange(!checked)}>
        <span className="cp-switch-thumb" />
      </button>
      <span className="field-label">{label}</span>
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="cp-tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={`cp-tab ${value === it.value ? "cp-tab-active" : ""}`} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Dialog ---------- */
export function Dialog({
  title, description, children, footer, onClose, wide,
}: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.dialog-x)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dialog-head">
          <div style={{ flex: 1 }}>
            <div className="dialog-title">{title}</div>
            {description && <div className="muted" style={{ marginTop: 2 }}>{description}</div>}
          </div>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close" className="dialog-x"><X size={16} /></Button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  title, body, confirmLabel, onConfirm, onClose, danger = true,
}: { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void | Promise<unknown>; onClose: () => void; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "destructive" : "default"} disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div>{body}</div>
    </Dialog>
  );
}

/* ---------- Misc ---------- */
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children && <div style={{ maxWidth: 440 }}>{children}</div>}
      {action}
    </div>
  );
}

export function Meter({ value, max, color, large, label }: { value: number; max: number; color?: string; large?: boolean; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const c = color ?? (pct >= 90 ? "var(--st-critical)" : pct >= 80 ? "var(--st-warning)" : "var(--foreground)");
  return (
    <div className={`meter ${large ? "meter-lg" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%`, background: c }} />
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="codeblock">
      <Button
        variant="ghost" size="sm" icon className="copy" aria-label="Copy command"
        onClick={() => { navigator.clipboard?.writeText(code); setDone(true); setTimeout(() => setDone(false), 1500); }}
      >
        {done ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      <span style={{ display: "block", paddingRight: 28 }}>{code}</span>
    </div>
  );
}

export function Props({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="props">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone === "error" ? "toast-error" : ""}`}>
          {t.tone === "error" ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Sortable table helper. */
export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number | null;
  align?: "r";
}
export function DataTable<T extends { id: number }>({ rows, columns, onRow, empty }: { rows: T[]; columns: Column<T>[]; onRow?: (r: T) => void; empty?: ReactNode }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  })();
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="cp-db-scroll">
      <table className="cp-db-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "r" ? "r" : ""} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {c.sort ? (
                  <button onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} onClick={() => onRow?.(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onRow?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "r" ? "r" : ""}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function downloadFile(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
