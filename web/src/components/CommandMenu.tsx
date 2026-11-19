import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Boxes, Database, HardDrive, LayoutDashboard, Search, Server as ServerIcon } from "lucide-react";
import { useStore } from "../store";
import type { Ref } from "../types";
import { fmtGB } from "../lib/zfs";

interface Item { id: string; group: string; label: string; hint?: string; icon: ReactNode; run: () => void; }

export function CommandMenu({ onClose, go, pages }: { onClose: () => void; go: (r: string) => void; pages: { route: string; label: string }[] }) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const has = (...xs: (string | null | undefined)[]) => !query || xs.some((x) => x?.toLowerCase().includes(query));
    const open = (r: Ref) => () => { store.open(r); onClose(); };
    const out: Item[] = [];
    for (const p of pages) if (has(p.label)) out.push({ id: `g${p.route}`, group: "Go to", label: p.label, icon: <LayoutDashboard size={16} />, run: () => { go(p.route); onClose(); } });
    for (const d of store.state.disks) if (has(d.serial, d.model, d.wwn)) out.push({ id: `d${d.id}`, group: "Disks", label: d.serial, hint: `${fmtGB(d.capacity_gb)} · ${store.pool(d.pool_id)?.name ?? "no pool"}`, icon: <HardDrive size={16} />, run: open({ type: "disk", id: d.id }) });
    for (const p of store.state.pools) if (has(p.name, p.purpose)) out.push({ id: `p${p.id}`, group: "Pools", label: p.name, hint: p.status, icon: <Database size={16} />, run: open({ type: "pool", id: p.id }) });
    for (const s of store.state.servers) if (has(s.name, s.model, s.hostname, s.ip, s.serial)) out.push({ id: `s${s.id}`, group: "Servers", label: s.name, hint: s.model ?? undefined, icon: <ServerIcon size={16} />, run: open({ type: "server", id: s.id }) });
    for (const s of store.state.services) if (has(s.name, s.url, s.ip)) out.push({ id: `v${s.id}`, group: "Services", label: s.name, hint: s.kind, icon: <Boxes size={16} />, run: open({ type: "service", id: s.id }) });
    return out.slice(0, 60);
  }, [q, store, go, onClose, pages]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    document.querySelector(".cp-cmd-item-sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") items[sel]?.run();
    else if (e.key === "Escape") onClose();
  };

  let lastGroup = "";
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp-cmd" role="dialog" aria-label="Search">
        <div className="cp-cmd-input">
          <Search size={16} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search disks, pools, servers, services…" aria-label="Search" />
          <span className="cp-kbd">Esc</span>
        </div>
        <div className="cp-cmd-list" role="listbox">
          {!items.length && <div className="cp-cmd-empty">Nothing matches “{q}”.</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="cp-cmd-group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head}
                <div role="option" aria-selected={i === sel} className={`cp-cmd-item ${i === sel ? "cp-cmd-item-sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
                  {it.icon}
                  <span className={`cp-cmd-label ${it.group === "Disks" ? "mono" : ""}`}>{it.label}</span>
                  {it.hint && <span className="cp-cmd-hint">{it.hint}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
