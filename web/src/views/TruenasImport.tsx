import { useState } from "react";
import { AlertTriangle, CloudDownload, KeyRound, ShieldAlert } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import type { Layout } from "../types";
import { Button, Confirm, Field, Tag } from "../components/ui";
import { LAYOUT_LABEL, fmtGB } from "../lib/zfs";

export interface SavedTruenas {
  url?: string;
  insecure_tls?: boolean;
  allow_http?: boolean;
  server_id?: number | null;
  include_unused?: boolean;
  include_shares?: boolean;
  include_apps?: boolean;
  last_sync?: string;
  has_key?: boolean;
}

interface Plan {
  transport: "websocket" | "rest";
  version: string;
  server: { id: number | null; name: string; data: Record<string, any> };
  pools: { id: number | null; name: string; data: Record<string, any>; vdevs: number; disks: number; missing: number }[];
  disks: { id: number | null; serial: string; pool: string | null; data: Record<string, any> }[];
  unlink: { id: number; serial: string; pool: string }[];
  services: { id: number | null; name: string; data: Record<string, any>; maps: { pool: string; dataset: string }[] }[];
  warnings: string[];
}

export function savedTruenas(settings: Record<string, unknown>): SavedTruenas | null {
  const v = settings.truenas as SavedTruenas | undefined;
  return v && v.url ? v : null;
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="cp-checkbox-label" style={{ fontWeight: 400, alignItems: "flex-start" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 2 }} />
      <span>{children}</span>
    </label>
  );
}

export function TruenasImport() {
  const store = useStore();
  const saved = savedTruenas(store.state.settings);
  const [url, setUrl] = useState(saved?.url ?? "");
  const [key, setKey] = useState("");
  const [insecure, setInsecure] = useState(saved?.insecure_tls ?? false);
  const [allowHttp, setAllowHttp] = useState(saved?.allow_http ?? false);
  const [serverId, setServerId] = useState(saved?.server_id && store.server(saved.server_id) ? String(saved.server_id) : "");
  const [unused, setUnused] = useState(saved?.include_unused ?? true);
  const [shares, setShares] = useState(saved?.include_shares ?? true);
  const [apps, setApps] = useState(saved?.include_apps ?? true);
  const [remember, setRemember] = useState(true);
  const [rememberKey, setRememberKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [forget, setForget] = useState(false);

  const useSaved = !key.trim() && !!saved?.has_key;
  const body = () => ({
    url, api_key: key.trim() || undefined, use_saved_key: useSaved, insecure_tls: insecure, allow_http: allowHttp,
    server_id: serverId ? Number(serverId) : null, include_unused: unused, include_shares: shares, include_apps: apps,
    remember, remember_key: remember && rememberKey && !!key.trim(),
  });
  const reset = () => { setPlan(null); setErr(null); };

  const preview = async () => {
    setBusy(true);
    setErr(null);
    try { setPlan(await api.post<Plan>("/api/truenas/preview", body())); }
    catch (e: any) { setErr(e.message); setPlan(null); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setBusy(true);
    const r = await store.action<{ pools: number; disks: number; created: number; unlinked: number; services: number; server_id: number }>("/api/truenas/apply", body());
    setBusy(false);
    if (r) {
      store.toast(`Imported ${r.pools} pools and ${r.disks} disks (${r.created} new)${r.services ? `, ${r.services} services` : ""}.`);
      setPlan(null);
      setKey("");
      store.open({ type: "server", id: r.server_id });
    }
  };

  const newDisks = plan?.disks.filter((d) => !d.id).length ?? 0;
  const canGo = !!url.trim() && (!!key.trim() || !!saved?.has_key);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="cp-card">
        <div className="cp-card-desc">
          ZFStack's server connects to TrueNAS and reads its pools, vdev layout, disks, temperatures, shares and apps.
          Create a key in TrueNAS under your user menu, <strong>API Keys</strong>. A read-only user is enough.
        </div>
        <div className="form-grid">
          <Field label="TrueNAS address" help="For example https://truenas.lab or https://10.0.10.20:443">
            <input className="cp-input" value={url} onChange={(e) => { setUrl(e.target.value); reset(); }} placeholder="https://truenas.lab" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="API key" help={saved?.has_key ? "Leave empty to use the saved key." : "Sent to TrueNAS only from the ZFStack server."}>
            <input className="cp-input mono" type="password" value={key} onChange={(e) => { setKey(e.target.value); reset(); }}
              placeholder={saved?.has_key ? "Saved key" : "1-AbCdEf…"} autoComplete="new-password" spellCheck={false} />
          </Field>
          <Field label="Import into" help="Matches an existing server by host name when left on automatic.">
            <select className="cp-select" value={serverId} onChange={(e) => { setServerId(e.target.value); reset(); }}>
              <option value="">Automatic (match host name, or create)</option>
              {store.state.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="field">
            <span className="field-label">Include</span>
            <Check checked={unused} onChange={(v) => { setUnused(v); reset(); }}>Disks that are in no pool</Check>
            <Check checked={shares} onChange={(v) => { setShares(v); reset(); }}>SMB and NFS shares as services</Check>
            <Check checked={apps} onChange={(v) => { setApps(v); reset(); }}>Apps as services</Check>
          </div>
          <div className="field">
            <span className="field-label">Connection</span>
            <Check checked={insecure} onChange={(v) => { setInsecure(v); reset(); }}>Accept self-signed certificate</Check>
            <Check checked={allowHttp} onChange={(v) => { setAllowHttp(v); reset(); }}>Allow plain HTTP</Check>
            {allowHttp && (
              <span className="status status-warning" style={{ whiteSpace: "normal" }}>
                <AlertTriangle size={14} /> TrueNAS 25.04 and later revoke a key sent over HTTP.
              </span>
            )}
          </div>
          <div className="field">
            <span className="field-label">After import</span>
            <Check checked={remember} onChange={setRemember}>Remember this connection for quick syncs</Check>
            <Check checked={rememberKey} onChange={setRememberKey}>
              Also store the API key on the ZFStack server
            </Check>
            {rememberKey && <span className="field-help">Stored in your Postgres database, never sent back to browsers or included in backups.</span>}
          </div>
        </div>
        <div className="row">
          <Button variant="outline" disabled={!canGo || busy} onClick={preview}><CloudDownload size={16} /> {busy && !plan ? "Connecting…" : "Preview"}</Button>
          {plan && <Button disabled={busy} onClick={apply}>Import from {plan.server.name}</Button>}
          {saved && (
            <span className="caption muted row" style={{ gap: 6 }}>
              <KeyRound size={12} /> Saved connection{saved.last_sync ? `, last sync ${new Date(saved.last_sync).toLocaleString()}` : ""}.
              <Button variant="ghost" size="sm" onClick={() => setForget(true)}>Forget</Button>
            </span>
          )}
        </div>
        {err && (
          <div className="cp-callout cp-callout-danger"><ShieldAlert size={16} /><div>{err}</div></div>
        )}
      </section>

      {plan && (
        <section className="cp-card">
          <div className="cp-card-head">
            <span className="cp-card-title">Preview</span>
            <span className="caption muted">TrueNAS {plan.version} · {plan.transport === "websocket" ? "JSON-RPC API" : "REST API"}</span>
          </div>
          <div className="row">
            <Tag color={plan.server.id ? "blue" : "green"}>{plan.server.id ? "Update" : "New"} server</Tag>
            <strong>{plan.server.name}</strong>
            <span className="muted">{[plan.server.data.model, plan.server.data.os, plan.server.data.ram_gb ? `${plan.server.data.ram_gb} GB RAM` : null].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="cp-db-scroll">
            <table className="cp-db-table">
              <thead><tr><th>Pool</th><th>Layout</th><th className="r">Vdevs</th><th className="r">Disks</th><th className="r">Used</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {plan.pools.map((p) => (
                  <tr key={p.name} style={{ cursor: "default" }}>
                    <td className="mono cp-db-title">{p.name}</td>
                    <td>{LAYOUT_LABEL[p.data.layout as Layout] ?? p.data.layout}</td>
                    <td className="r">{p.vdevs}</td>
                    <td className="r">{p.disks}{p.missing ? <span className="muted"> (+{p.missing} missing)</span> : null}</td>
                    <td className="r">{fmtGB(p.data.used_gb)}</td>
                    <td>{p.data.status}</td>
                    <td>{p.id ? <Tag color="blue">Update</Tag> : <Tag color="green">Create</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span>
              <strong>{plan.disks.length} disks:</strong> {newDisks} new, {plan.disks.length - newDisks} updated.
              {newDisks > 0 && " New disks land on the shelf; drag them into their bays in the rack view."}
            </span>
            {plan.unlink.length > 0 && (
              <span className="status status-warning" style={{ whiteSpace: "normal" }}>
                <AlertTriangle size={14} /> {plan.unlink.length} disk{plan.unlink.length === 1 ? "" : "s"} listed in ZFStack are no longer in these pools and become available: {plan.unlink.map((u) => u.serial).join(", ")}.
              </span>
            )}
            {plan.services.length > 0 && (
              <span><strong>{plan.services.length} services:</strong> {plan.services.map((s) => `${s.name}${s.id ? "" : " (new)"}`).join(", ")}.</span>
            )}
            {plan.warnings.map((w) => <span key={w} className="caption muted">{w}</span>)}
          </div>
          <div className="caption muted">Bays, criticality, prices and notes you set in ZFStack are kept. Nothing is changed on TrueNAS.</div>
        </section>
      )}
      {forget && (
        <Confirm
          title="Forget the saved TrueNAS connection?"
          body="The address, options and any stored API key are removed from the ZFStack server. Imported pools and disks stay."
          confirmLabel="Forget connection"
          onClose={() => setForget(false)}
          onConfirm={async () => { await api.del("/api/truenas/saved"); await store.reload(); store.toast("Saved connection removed."); }}
        />
      )}
    </div>
  );
}
