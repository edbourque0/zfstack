import { useMemo, useState } from "react";
import { Boxes, Database, Network, Server as ServerIcon } from "lucide-react";
import { useStore } from "../store";
import { Empty, PoolStatus, PoolSwatch } from "../components/ui";
import { SVC_KIND } from "../components/details";
import { fmtGB } from "../lib/zfs";

type Node = `s${number}` | `p${number}` | `e${number}`;

/** Services → pools → enclosures. Pick any node to see everything it touches. */
export default function MapView() {
  const store = useStore();
  const { state } = store;
  const [sel, setSel] = useState<Node | null>(null);
  const [hov, setHov] = useState<Node | null>(null);
  const focus = hov ?? sel;

  const edges = useMemo(() => {
    const svcPools = new Map<number, Set<number>>();
    const poolSvcs = new Map<number, Set<number>>();
    const poolEncl = new Map<number, Set<number>>();
    const enclPools = new Map<number, Set<number>>();
    const add = <K,>(m: Map<K, Set<number>>, k: K, v: number) => m.set(k, (m.get(k) ?? new Set()).add(v));
    for (const m of state.service_pools) { add(svcPools, m.service_id, m.pool_id); add(poolSvcs, m.pool_id, m.service_id); }
    for (const d of state.disks) if (d.pool_id && d.server_id) { add(poolEncl, d.pool_id, d.server_id); add(enclPools, d.server_id, d.pool_id); }
    return { svcPools, poolSvcs, poolEncl, enclPools };
  }, [state]);

  const related = useMemo(() => {
    const r = new Set<Node>();
    if (!focus) return r;
    const id = Number(focus.slice(1));
    const pools = new Set<number>();
    if (focus[0] === "s") edges.svcPools.get(id)?.forEach((p) => pools.add(p));
    if (focus[0] === "p") pools.add(id);
    if (focus[0] === "e") edges.enclPools.get(id)?.forEach((p) => pools.add(p));
    pools.forEach((p) => {
      r.add(`p${p}`);
      edges.poolEncl.get(p)?.forEach((e) => r.add(`e${e}`));
      if (focus[0] !== "s") edges.poolSvcs.get(p)?.forEach((s) => r.add(`s${s}`));
    });
    r.add(focus);
    return r;
  }, [focus, edges]);

  const cls = (n: Node) => (focus ? (n === focus ? "on" : related.has(n) ? "rel" : "dim") : "");
  const node = (n: Node, content: React.ReactNode, onOpen: () => void) => (
    <button key={n} className={`map-node ${cls(n)}`} onMouseEnter={() => setHov(n)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(n)} onBlur={() => setHov(null)}
      onClick={() => (sel === n ? onOpen() : setSel(n))} title={sel === n ? "Click again to open" : "Click to pin, click again to open"}>
      {content}
    </button>
  );
  const enclosures = state.servers.filter((s) => edges.enclPools.has(s.id) || s.bay_count > 0);

  if (!state.pools.length) {
    return (
      <div className="page"><div className="page-head"><div><h1 className="page-title">Dependencies</h1></div></div>
        <Empty icon={<Network size={28} />} title="Nothing to connect yet">Add pools, map services to them and place their disks in enclosures. This view then shows what depends on what.</Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dependencies</h1>
          <p className="page-sub">Point at a service, pool or enclosure to see its blast radius. Click to pin it, click again to open it.</p>
        </div>
      </div>
      <div className="map" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} onMouseLeave={() => setHov(null)}>
        <div className="map-col">
          <div className="sub-title"><Boxes size={14} /> Services · {state.services.length}</div>
          {state.services.map((s) => node(`s${s.id}`, <><span className="t">{s.name}</span><span className="s">{SVC_KIND[s.kind]}</span></>, () => store.open({ type: "service", id: s.id })))}
          {!state.services.length && <div className="muted caption">No services yet.</div>}
        </div>
        <div className="map-col">
          <div className="sub-title"><Database size={14} /> Pools · {state.pools.length}</div>
          {state.pools.map((p) => node(`p${p.id}`, <><PoolSwatch pool={p} /><span className="t mono">{p.name}</span><span className="s">{p.status === "online" ? fmtGB(store.geometry(p).usable_gb) : <PoolStatus p={p} />}</span></>, () => store.open({ type: "pool", id: p.id })))}
        </div>
        <div className="map-col">
          <div className="sub-title"><ServerIcon size={14} /> Enclosures · {enclosures.length}</div>
          {enclosures.map((s) => node(`e${s.id}`, <><span className="t">{s.name}</span><span className="s">{state.disks.filter((d) => d.server_id === s.id).length} disks</span></>, () => store.open({ type: "server", id: s.id })))}
        </div>
      </div>
      {focus && (
        <div className="cp-callout cp-callout-info">
          <Network size={16} />
          <div>
            {(() => {
              const id = Number(focus.slice(1));
              const pools = [...related].filter((n) => n[0] === "p").length;
              const svcs = [...related].filter((n) => n[0] === "s" && n !== focus).length;
              const encl = [...related].filter((n) => n[0] === "e" && n !== focus).length;
              if (focus[0] === "e") return <>If <strong>{store.server(id)?.name}</strong> goes offline, {pools} pool{pools === 1 ? "" : "s"} lose disks and {svcs} service{svcs === 1 ? "" : "s"} may stop.</>;
              if (focus[0] === "p") return <><strong>{store.pool(id)?.name}</strong> spans {encl} enclosure{encl === 1 ? "" : "s"} and serves {svcs} service{svcs === 1 ? "" : "s"}.</>;
              return <><strong>{store.service(id)?.name}</strong> depends on {pools} pool{pools === 1 ? "" : "s"} spread over {encl} enclosure{encl === 1 ? "" : "s"}.</>;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
