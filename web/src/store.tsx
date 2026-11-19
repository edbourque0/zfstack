import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Collection, Disk, Pool, Ref, Server, Service, State } from "./types";
import { POOL_SLOTS, poolGeometry, type PoolGeometry } from "./lib/zfs";
import { computeAlerts, type Alert } from "./lib/alerts";

const EMPTY: State = { racks: [], servers: [], pools: [], disks: [], services: [], service_pools: [], events: [], settings: {} };

export interface Toast {
  id: number;
  text: string;
  tone: "default" | "error";
}

interface Ctx {
  state: State;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: <T = unknown>(c: Collection, data: Record<string, unknown>, msg?: string) => Promise<T | null>;
  update: <T = unknown>(c: Collection, id: number, data: Record<string, unknown>, msg?: string) => Promise<T | null>;
  remove: (c: Collection, id: number, msg?: string) => Promise<boolean>;
  action: <T = unknown>(url: string, body?: unknown, msg?: string) => Promise<T | null>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  // lookups
  server: (id: number | null | undefined) => Server | undefined;
  pool: (id: number | null | undefined) => Pool | undefined;
  disk: (id: number | null | undefined) => Disk | undefined;
  service: (id: number | null | undefined) => Service | undefined;
  geometry: (p: Pool) => PoolGeometry;
  poolColor: (p: Pool | undefined) => number | null;
  alerts: Alert[];
  // detail drawer
  detail: Ref | null;
  open: (r: Ref | null) => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [detail, setDetail] = useState<Ref | null>(null);

  const toast = useCallback((text: string, tone: Toast["tone"] = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  const reload = useCallback(async () => {
    try {
      setState(await api.get<State>("/api/state"));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Could not reach the ZFStack server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const wrap = useCallback(
    async <T,>(fn: () => Promise<T>, msg?: string): Promise<T | null> => {
      try {
        const out = await fn();
        await reload();
        if (msg) toast(msg);
        return out;
      } catch (e: any) {
        toast(e.message ?? "That did not work.", "error");
        return null;
      }
    },
    [reload, toast],
  );

  const value = useMemo<Ctx>(() => {
    const maps = {
      servers: new Map(state.servers.map((x) => [x.id, x])),
      pools: new Map(state.pools.map((x) => [x.id, x])),
      disks: new Map(state.disks.map((x) => [x.id, x])),
      services: new Map(state.services.map((x) => [x.id, x])),
    };
    const geoCache = new Map<number, PoolGeometry>();
    // Pools without an explicit colour take the free slots in creation order.
    const taken = new Set(state.pools.map((p) => p.color).filter((c): c is number => c !== null && c < POOL_SLOTS));
    const auto = new Map<number, number | null>();
    let next = 0;
    for (const p of [...state.pools].sort((a, b) => a.id - b.id)) {
      if (p.color !== null && p.color < POOL_SLOTS) continue;
      while (taken.has(next) && next < POOL_SLOTS) next++;
      auto.set(p.id, next < POOL_SLOTS ? next : null);
      if (next < POOL_SLOTS) taken.add(next);
    }
    return {
      state,
      loading,
      error,
      reload,
      toast,
      toasts,
      create: (c, data, msg) => wrap(() => api.post(`/api/${c}`, data), msg),
      update: (c, id, data, msg) => wrap(() => api.patch(`/api/${c}/${id}`, data), msg),
      remove: async (c, id, msg) => (await wrap(() => api.del(`/api/${c}/${id}`).then(() => true), msg)) ?? false,
      action: (url, body, msg) => wrap(() => api.post(url, body), msg),
      server: (id) => (id ? maps.servers.get(id) : undefined),
      pool: (id) => (id ? maps.pools.get(id) : undefined),
      disk: (id) => (id ? maps.disks.get(id) : undefined),
      service: (id) => (id ? maps.services.get(id) : undefined),
      geometry: (p) => {
        let g = geoCache.get(p.id);
        if (!g) geoCache.set(p.id, (g = poolGeometry(p, state.disks)));
        return g;
      },
      poolColor: (p) => (p ? (p.color !== null && p.color < POOL_SLOTS ? p.color : auto.get(p.id) ?? null) : null),
      alerts: computeAlerts(state),
      detail,
      open: setDetail,
    };
  }, [state, loading, error, reload, toast, toasts, wrap, detail]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore outside StoreProvider");
  return c;
}
