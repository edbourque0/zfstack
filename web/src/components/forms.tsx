import { useMemo, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useStore } from "../store";
import type { Collection, State } from "../types";
import { Button, Confirm, Dialog, Field } from "./ui";
import { LAYOUT_LABEL } from "../lib/zfs";

type Opt = [string, string];
type Spec =
  | { key: string; label: string; type: "text" | "date" | "textarea" | "datetime"; help?: string; full?: boolean; placeholder?: string; required?: boolean; mono?: boolean }
  | { key: string; label: string; type: "number"; help?: string; full?: boolean; placeholder?: string; required?: boolean; step?: string; min?: number }
  | { key: string; label: string; type: "select"; options: Opt[]; help?: string; full?: boolean; required?: boolean }
  | { key: string; label: string; type: "ref"; ref: "racks" | "servers" | "pools" | "services" | "disks"; help?: string; full?: boolean; required?: boolean; filter?: (row: any, form: Record<string, any>) => boolean }
  | { key: string; label: string; type: "bool"; help?: string; full?: boolean }
  | { key: string; label: string; type: "bay"; help?: string; full?: boolean }
  | { key: string; label: string; type: "heading"; full?: boolean };

export const POOL_COLOR_NAMES = ["Blue", "Orange", "Aqua", "Yellow", "Magenta", "Green"];

const o = (...xs: string[]): Opt[] => xs.map((x) => [x, x[0].toUpperCase() + x.slice(1)]);

export const SPECS: Record<Collection, Spec[]> = {
  racks: [
    { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Basement rack" },
    { key: "height_u", label: "Height (U)", type: "number", min: 1, help: "Common sizes: 12, 24, 42." },
    { key: "location", label: "Location", type: "text", full: true },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  servers: [
    { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. pve01" },
    { key: "kind", label: "Type", type: "select", options: [["server", "Server"], ["nas", "NAS"], ["jbod", "JBOD / disk shelf"], ["switch", "Switch"], ["ups", "UPS"], ["other", "Other"]] },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "e.g. HPE" },
    { key: "model", label: "Model", type: "text", placeholder: "e.g. ProLiant DL380 Gen9" },
    { key: "serial", label: "Serial number", type: "text", mono: true },
    { key: "status", label: "Status", type: "select", options: o("active", "standby", "maintenance", "offline", "planned", "retired") },
    { key: "h1", label: "Drive bays", type: "heading" },
    { key: "bay_count", label: "Number of bays", type: "number", min: 0, help: "Each bay becomes a disk location." },
    { key: "bay_rows", label: "Bay rows", type: "number", min: 1, help: "1 for a row of upright bays, 3 for a 12-bay 2U grid." },
    { key: "bay_form", label: "Bay size", type: "select", options: [["3.5", "3.5\""], ["2.5", "2.5\""], ["nvme", "NVMe / U.2"]] },
    { key: "host_id", label: "Attached to", type: "ref", ref: "servers", help: "For a JBOD: the server its HBA plugs into.", filter: (r, f) => r.id !== f.id },
    { key: "h2", label: "Rack placement", type: "heading" },
    { key: "rack_id", label: "Rack", type: "ref", ref: "racks" },
    { key: "rack_u", label: "Bottom unit (U)", type: "number", min: 1, help: "Lowest U the device occupies." },
    { key: "height_u", label: "Height (U)", type: "number", min: 1 },
    { key: "power_watts", label: "Power draw (W)", type: "number", min: 0 },
    { key: "h3", label: "System", type: "heading" },
    { key: "hostname", label: "Hostname", type: "text" },
    { key: "ip", label: "IP address", type: "text", mono: true },
    { key: "os", label: "Operating system", type: "text", placeholder: "e.g. Proxmox VE 9" },
    { key: "cpu", label: "CPU", type: "text" },
    { key: "ram_gb", label: "RAM (GB)", type: "number", min: 0 },
    { key: "h4", label: "Purchase", type: "heading" },
    { key: "purchase_date", label: "Purchase date", type: "date" },
    { key: "warranty_until", label: "Warranty until", type: "date" },
    { key: "price", label: "Price", type: "number", step: "0.01", min: 0 },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  pools: [
    { key: "name", label: "Pool name", type: "text", required: true, placeholder: "e.g. tank", mono: true },
    { key: "server_id", label: "Host", type: "ref", ref: "servers" },
    { key: "layout", label: "Layout", type: "select", options: Object.entries(LAYOUT_LABEL) as Opt[], help: "Vdev type for data disks. Group disks into vdevs with the disk's vdev name." },
    { key: "status", label: "Status", type: "select", options: o("online", "degraded", "faulted", "offline", "migrating", "planned", "retired") },
    { key: "draid_data", label: "dRAID data disks per group", type: "number", min: 1, help: "Only for dRAID. Leave empty for the widest group." },
    { key: "draid_spares", label: "dRAID distributed spares", type: "number", min: 0 },
    { key: "used_gb", label: "Used space (GB)", type: "number", min: 0, help: "From zfs list -o used or zpool list ALLOC." },
    { key: "color", label: "Colour on the rack", type: "select", options: [["", "Automatic"], ...POOL_COLOR_NAMES.map((n, i): Opt => [String(i), n])] },
    { key: "h1", label: "Properties", type: "heading" },
    { key: "ashift", label: "ashift", type: "number", min: 9, help: "12 for 4K sectors, 13 for many SSDs." },
    { key: "compression", label: "Compression", type: "select", options: o("lz4", "zstd", "zstd-3", "gzip", "off") },
    { key: "recordsize", label: "Record size", type: "select", options: o("16K", "32K", "64K", "128K", "256K", "512K", "1M") },
    { key: "encryption", label: "Encrypted", type: "bool" },
    { key: "dedup", label: "Deduplication", type: "bool" },
    { key: "h2", label: "Maintenance", type: "heading" },
    { key: "last_scrub", label: "Last scrub", type: "date" },
    { key: "scrub_interval_days", label: "Scrub every (days)", type: "number", min: 1 },
    { key: "last_snapshot", label: "Last snapshot", type: "date" },
    { key: "purpose", label: "Purpose", type: "text", full: true },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  disks: [
    { key: "serial", label: "Serial number", type: "text", required: true, mono: true },
    { key: "capacity_gb", label: "Capacity (GB)", type: "number", required: true, min: 1, help: "Vendor size: 8 TB is 8000." },
    { key: "vendor", label: "Vendor", type: "text", placeholder: "e.g. Seagate" },
    { key: "model", label: "Model", type: "text", placeholder: "e.g. ST8000VN004" },
    { key: "media", label: "Media", type: "select", options: [["hdd", "HDD"], ["ssd", "SSD"], ["nvme", "NVMe"]] },
    { key: "interface", label: "Interface", type: "select", options: [["sata", "SATA"], ["sas", "SAS"], ["nvme", "NVMe"], ["usb", "USB"]] },
    { key: "rpm", label: "RPM", type: "number", min: 0, help: "Leave empty for SSDs." },
    { key: "form_factor", label: "Form factor", type: "select", options: [["3.5", "3.5\""], ["2.5", "2.5\""], ["m.2", "M.2"], ["u.2", "U.2"], ["pcie", "PCIe card"]] },
    { key: "h1", label: "Location", type: "heading" },
    { key: "server_id", label: "Server", type: "ref", ref: "servers", filter: (r) => r.bay_count > 0 },
    { key: "bay", label: "Bay", type: "bay" },
    { key: "h2", label: "ZFS", type: "heading" },
    { key: "pool_id", label: "Pool", type: "ref", ref: "pools" },
    { key: "role", label: "Role", type: "select", options: [["data", "Data"], ["spare", "Hot spare"], ["log", "SLOG (log)"], ["special", "Special (metadata)"], ["cache", "L2ARC (cache)"], ["dedup", "Dedup"]] },
    { key: "vdev", label: "Vdev", type: "text", mono: true, placeholder: "e.g. raidz2-0", help: "Disks with the same vdev name form one vdev." },
    { key: "status", label: "Status", type: "select", options: o("online", "degraded", "faulted", "available", "testing", "failed", "retired") },
    { key: "h3", label: "Health", type: "heading" },
    { key: "smart_status", label: "SMART", type: "select", options: o("passed", "warning", "failed", "unknown") },
    { key: "last_smart_test", label: "Last SMART test", type: "date" },
    { key: "power_on_hours", label: "Power-on hours", type: "number", min: 0 },
    { key: "temperature_c", label: "Temperature (°C)", type: "number" },
    { key: "reallocated_sectors", label: "Reallocated sectors", type: "number", min: 0 },
    { key: "sector_size", label: "Sector size (bytes)", type: "select", options: [["512", "512"], ["4096", "4096"], ["520", "520 (needs reformat)"], ["528", "528 (needs reformat)"]] },
    { key: "h4", label: "Identity and purchase", type: "heading" },
    { key: "wwn", label: "WWN", type: "text", mono: true },
    { key: "firmware", label: "Firmware", type: "text", mono: true },
    { key: "purchase_date", label: "Purchase date", type: "date" },
    { key: "warranty_until", label: "Warranty until", type: "date" },
    { key: "price", label: "Price", type: "number", step: "0.01", min: 0 },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  services: [
    { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Jellyfin" },
    { key: "kind", label: "Type", type: "select", options: [["vm", "VM"], ["lxc", "LXC"], ["docker", "Docker"], ["app", "App"], ["share", "Share (SMB/NFS)"], ["backup", "Backup job"], ["baremetal", "Bare metal"]] },
    { key: "server_id", label: "Runs on", type: "ref", ref: "servers" },
    { key: "status", label: "Status", type: "select", options: o("running", "stopped", "planned", "retired") },
    { key: "criticality", label: "Criticality", type: "select", options: o("low", "medium", "high", "critical"), help: "How much it hurts when it is down." },
    { key: "url", label: "URL", type: "text", placeholder: "e.g. https://jellyfin.lab" },
    { key: "ip", label: "IP address", type: "text", mono: true },
    { key: "backup_policy", label: "Backup policy", type: "text", placeholder: "e.g. Nightly vzdump, keep 7" },
    { key: "description", label: "Description", type: "text", full: true },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  service_pools: [
    { key: "service_id", label: "Service", type: "ref", ref: "services", required: true },
    { key: "pool_id", label: "Pool", type: "ref", ref: "pools", required: true },
    { key: "dataset", label: "Dataset or volume", type: "text", mono: true, placeholder: "e.g. tank/media" },
    { key: "used_gb", label: "Space used (GB)", type: "number", min: 0 },
    { key: "access", label: "Access", type: "select", options: [["rw", "Read and write"], ["ro", "Read only"]] },
    { key: "notes", label: "Notes", type: "textarea", full: true },
  ],
  events: [
    { key: "title", label: "Title", type: "text", required: true, full: true },
    { key: "kind", label: "Type", type: "select", options: o("note", "maintenance", "scrub", "replace", "failure", "purchase", "migration", "smart") },
    { key: "at", label: "When", type: "datetime" },
    { key: "disk_id", label: "Disk", type: "ref", ref: "disks" },
    { key: "pool_id", label: "Pool", type: "ref", ref: "pools" },
    { key: "server_id", label: "Server", type: "ref", ref: "servers" },
    { key: "service_id", label: "Service", type: "ref", ref: "services" },
    { key: "body", label: "Details", type: "textarea", full: true },
  ],
};

const NOUN: Record<Collection, string> = {
  racks: "rack", servers: "server", pools: "pool", disks: "disk", services: "service", service_pools: "pool mapping", events: "log entry",
};

const DEFAULTS: Partial<Record<Collection, Record<string, unknown>>> = {
  racks: { height_u: 42 },
  servers: { kind: "server", status: "active", height_u: 2, bay_count: 12, bay_rows: 3, bay_form: "3.5" },
  pools: { layout: "raidz2", status: "online", ashift: 12, compression: "lz4", recordsize: "128K", scrub_interval_days: 30, draid_spares: 0, encryption: false, dedup: false },
  disks: { media: "hdd", interface: "sata", form_factor: "3.5", role: "data", status: "available", smart_status: "unknown", sector_size: 512 },
  services: { kind: "docker", status: "running", criticality: "medium" },
  service_pools: { access: "rw" },
  events: { kind: "note" },
};

function refLabel(c: string, r: any): string {
  if (c === "disks") return `${r.serial}${r.model ? ` · ${r.model}` : ""}`;
  return r.name;
}

function toInput(spec: Spec, v: unknown): any {
  if (v === null || v === undefined) return spec.type === "bool" ? false : "";
  if (spec.type === "datetime" && typeof v === "string") {
    const d = new Date(v);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return typeof v === "boolean" ? v : String(v);
}

function fromInput(spec: Spec, v: any): unknown {
  if (spec.type === "bool") return !!v;
  if (v === "" || v === undefined) return null;
  if (spec.type === "number" || spec.type === "ref" || spec.type === "bay") return Number(v);
  if (spec.type === "datetime") return new Date(v).toISOString();
  if (spec.key === "color" || spec.key === "sector_size") return Number(v);
  return v;
}

export function FieldInput({ spec, form, set, state }: { spec: Spec; form: Record<string, any>; set: (k: string, v: any) => void; state: State }) {
  const v = form[spec.key];
  switch (spec.type) {
    case "heading":
      return null;
    case "textarea":
      return <textarea className="cp-textarea" value={v} onChange={(e) => set(spec.key, e.target.value)} />;
    case "select":
      return (
        <select className="cp-select" value={v} onChange={(e) => set(spec.key, e.target.value)}>
          {(v === "" || spec.options.some(([val]) => val === v) ? spec.options : [...spec.options, [v, v] as Opt]).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      );
    case "ref": {
      const rows = (state[spec.ref] as any[]).filter((r) => !spec.filter || spec.filter(r, form));
      return (
        <select className="cp-select" value={v} onChange={(e) => set(spec.key, e.target.value)} required={spec.required}>
          <option value="">{spec.required ? "Choose…" : "None"}</option>
          {rows.map((r) => <option key={r.id} value={String(r.id)}>{refLabel(spec.ref, r)}</option>)}
        </select>
      );
    }
    case "bay": {
      const srv = state.servers.find((s) => String(s.id) === String(form.server_id));
      if (!srv) return <select className="cp-select" disabled><option>Choose a server first</option></select>;
      const used = new Map(state.disks.filter((d) => d.server_id === srv.id && d.bay !== null && d.id !== form.id).map((d) => [d.bay!, d.serial]));
      return (
        <select className="cp-select" value={v} onChange={(e) => set(spec.key, e.target.value)}>
          <option value="">Not in a bay</option>
          {Array.from({ length: srv.bay_count }, (_, i) => (
            <option key={i} value={String(i)} disabled={used.has(i)}>
              Bay {i}{used.has(i) ? ` · ${used.get(i)}` : ""}
            </option>
          ))}
        </select>
      );
    }
    case "bool":
      return (
        <span className="cp-checkbox-label" style={{ height: 36 }}>
          <input type="checkbox" checked={!!v} onChange={(e) => set(spec.key, e.target.checked)} />
          {v ? "Yes" : "No"}
        </span>
      );
    default:
      return (
        <input
          className={`cp-input ${"mono" in spec && spec.mono ? "mono" : ""}`}
          type={spec.type === "number" ? "number" : spec.type === "date" ? "date" : spec.type === "datetime" ? "datetime-local" : "text"}
          value={v}
          step={spec.type === "number" ? spec.step ?? "1" : undefined}
          min={spec.type === "number" ? spec.min : undefined}
          placeholder={"placeholder" in spec ? spec.placeholder : undefined}
          required={"required" in spec ? spec.required : undefined}
          onChange={(e) => set(spec.key, e.target.value)}
        />
      );
  }
}

/** Create or edit any object. */
export function EditDialog({
  collection, row, defaults, onClose, onSaved, title, extra,
}: {
  collection: Collection;
  row?: Record<string, any> | null;
  defaults?: Record<string, unknown>;
  onClose: () => void;
  onSaved?: (row: any) => void;
  title?: string;
  extra?: ReactNode;
}) {
  const store = useStore();
  const specs = SPECS[collection];
  const [form, setForm] = useState<Record<string, any>>(() => {
    const base = { ...(DEFAULTS[collection] ?? {}), ...(defaults ?? {}), ...(row ?? {}) };
    const f: Record<string, any> = { id: row?.id };
    for (const s of specs) if (s.type !== "heading") f[s.key] = toInput(s, base[s.key]);
    return f;
  });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: string, v: any) =>
    setForm((f) => {
      const n = { ...f, [k]: v };
      if (k === "server_id" && collection === "disks") n.bay = "";
      return n;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = {};
    for (const s of specs) if (s.type !== "heading") body[s.key] = fromInput(s, form[s.key]);
    const noun = NOUN[collection];
    const out = row?.id
      ? await store.update(collection, row.id, body, `Saved ${noun}.`)
      : await store.create(collection, body, `Created ${noun}.`);
    setBusy(false);
    if (out) {
      onSaved?.(out);
      onClose();
    }
  };

  const noun = NOUN[collection];
  return (
    <>
      <Dialog
        title={title ?? (row?.id ? `Edit ${noun}` : `New ${noun}`)}
        onClose={onClose}
        wide={specs.length > 12}
        footer={
          <>
            {row?.id && (
              <Button variant="ghost" className="left" onClick={() => setConfirmDel(true)}>
                <Trash2 size={16} /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="edit-form" disabled={busy}>{row?.id ? "Save changes" : `Create ${noun}`}</Button>
          </>
        }
      >
        {extra}
        <form id="edit-form" className="form-grid" onSubmit={submit}>
          {specs.map((s) =>
            s.type === "heading" ? (
              <div key={s.key} className="full sub-title" style={{ marginTop: 8, marginBottom: -4 }}>{s.label}</div>
            ) : (
              <Field key={s.key} label={s.label} help={"help" in s ? s.help : undefined} full={"full" in s ? s.full : false}>
                <FieldInput spec={s} form={form} set={set} state={store.state} />
              </Field>
            ),
          )}
        </form>
      </Dialog>
      {confirmDel && row?.id && (
        <Confirm
          title={`Delete this ${noun}?`}
          body={deleteWarning(collection, row, store.state)}
          confirmLabel={`Delete ${noun}`}
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            const ok = await store.remove(collection, row.id, `Deleted ${noun}.`);
            if (ok) {
              if (store.detail && "id" in store.detail && store.detail.id === row.id) store.open(null);
              onClose();
            }
          }}
        />
      )}
    </>
  );
}

function deleteWarning(c: Collection, row: any, s: State): ReactNode {
  if (c === "servers") {
    const n = s.disks.filter((d) => d.server_id === row.id).length;
    return n ? `Its ${n} disks stay in your inventory without a bay.` : "This cannot be undone.";
  }
  if (c === "pools") {
    const n = s.disks.filter((d) => d.pool_id === row.id).length;
    return `Its ${n} disks stay in your inventory without a pool, and its service mappings are removed. This only changes ZFStack, not the real pool.`;
  }
  if (c === "racks") return "Servers in it stay in your inventory, outside any rack.";
  return "This cannot be undone.";
}

/** Add many identical disks at once. */
export function BulkDiskDialog({ onClose, defaults }: { onClose: () => void; defaults?: Record<string, unknown> }) {
  const store = useStore();
  const specs = useMemo(
    () => SPECS.disks.filter((s) => ["capacity_gb", "vendor", "model", "media", "interface", "rpm", "form_factor", "server_id", "pool_id", "role", "vdev", "status", "purchase_date", "warranty_until", "price"].includes(s.key)),
    [],
  );
  const [form, setForm] = useState<Record<string, any>>(() => {
    const base = { ...DEFAULTS.disks, ...(defaults ?? {}) } as Record<string, unknown>;
    return Object.fromEntries(specs.map((s) => [s.key, toInput(s, base[s.key])]));
  });
  const [serials, setSerials] = useState("");
  const [startBay, setStartBay] = useState("");
  const list = serials.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    const template: Record<string, unknown> = {};
    for (const s of specs) template[s.key] = fromInput(s, form[s.key]);
    const out = await store.action("/api/disks/bulk", { template, serials: list, start_bay: startBay === "" ? null : Number(startBay) }, `Added ${list.length} disks.`);
    if (out) onClose();
  };
  return (
    <Dialog
      title="Add several disks"
      description="Paste one serial number per line. Every disk gets the details below."
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!list.length || !form.capacity_gb} onClick={submit}>Add {list.length || ""} disks</Button>
        </>
      }
    >
      <Field label="Serial numbers" help={`${list.length} serial${list.length === 1 ? "" : "s"}`}>
        <textarea className="cp-textarea mono" rows={5} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder={"ZL2ABC01\nZL2ABC02\nZL2ABC03"} />
      </Field>
      <div className="form-grid">
        {specs.map((s) => (
          <Field key={s.key} label={s.label} help={"help" in s ? s.help : undefined}>
            <FieldInput spec={s} form={form} set={set} state={store.state} />
          </Field>
        ))}
        <Field label="First bay" help="Disks fill consecutive bays from here. Leave empty to skip.">
          <input className="cp-input" type="number" min={0} value={startBay} onChange={(e) => setStartBay(e.target.value)} disabled={!form.server_id} />
        </Field>
      </div>
    </Dialog>
  );
}
