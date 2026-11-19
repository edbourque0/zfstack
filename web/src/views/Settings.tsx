import { useRef, useState } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { Button, Confirm, Tabs } from "../components/ui";
import { EditDialog } from "../components/forms";
import type { Rack } from "../types";
import type { Theme } from "../theme";

export default function SettingsView({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const store = useStore();
  const { state } = store;
  const [rack, setRack] = useState<Rack | null | "new">(null);
  const [pending, setPending] = useState<any>(null);
  const [erase, setErase] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.app !== "zfstack") throw new Error("This file is not a ZFStack export.");
      setPending(data);
    } catch (e: any) {
      store.toast(e.message ?? "Could not read that file.", "error");
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <div className="page-head"><div><h1 className="page-title">Settings</h1><p className="page-sub">Racks, appearance and backups of your ZFStack data.</p></div></div>

      <section className="cp-card">
        <div className="cp-card-head"><span className="cp-card-title">Appearance</span></div>
        <Tabs<Theme> value={theme} onChange={setTheme} items={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        <div className="caption muted">Saved in this browser. Press Ctrl+Shift+L to switch.</div>
      </section>

      <section className="cp-card">
        <div className="cp-card-head">
          <span className="cp-card-title">Racks</span>
          <Button variant="outline" size="sm" onClick={() => setRack("new")}><Plus size={14} /> Rack</Button>
        </div>
        {state.racks.length ? (
          <ul className="link-list">
            {state.racks.map((r) => (
              <li key={r.id}>
                <button className="link-row" onClick={() => setRack(r)}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  <span className="muted">{r.location}</span>
                  <span className="meta">{state.servers.filter((s) => s.rack_id === r.id).length} devices · {r.height_u}U</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="muted">No racks yet.</div>}
      </section>

      <section className="cp-card">
        <div className="cp-card-head"><span className="cp-card-title">Backup and restore</span></div>
        <div className="cp-card-desc">Your data lives in the Postgres database on your server. Download a JSON copy before big changes, or to move ZFStack to another host.</div>
        <div className="row">
          <a className="cp-btn cp-btn-outline" href="/api/export" download><Download size={16} /> Download backup</a>
          <Button variant="outline" onClick={() => file.current?.click()}><Upload size={16} /> Restore from file</Button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className="cp-card">
        <div className="cp-card-head"><span className="cp-card-title">Erase everything</span></div>
        <div className="cp-card-desc">Deletes every rack, server, disk, pool, service and log entry from ZFStack. Your real pools are not touched.</div>
        <div><Button variant="destructive" onClick={() => setErase(true)}>Erase all data</Button></div>
      </section>

      {rack && <EditDialog collection="racks" row={rack === "new" ? null : rack} onClose={() => setRack(null)} />}
      {pending && (
        <Confirm
          title="Replace all data with this backup?"
          body={`Everything currently in ZFStack is replaced by the backup from ${pending.exported_at ? new Date(pending.exported_at).toLocaleString() : "this file"}: ${pending.disks?.length ?? 0} disks, ${pending.pools?.length ?? 0} pools, ${pending.servers?.length ?? 0} servers.`}
          confirmLabel="Restore backup"
          onClose={() => setPending(null)}
          onConfirm={async () => { await store.action("/api/import", pending, "Backup restored."); store.open(null); }}
        />
      )}
      {erase && (
        <Confirm
          title="Erase all ZFStack data?"
          body="This cannot be undone. Download a backup first if you might need it."
          confirmLabel="Erase all data"
          onClose={() => setErase(false)}
          onConfirm={async () => { await api.post("/api/erase", { confirm: "erase" }); store.open(null); await store.reload(); store.toast("All data erased."); }}
        />
      )}
    </div>
  );
}
