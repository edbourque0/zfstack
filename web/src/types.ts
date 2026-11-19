export interface Rack {
  id: number;
  name: string;
  height_u: number;
  location: string | null;
  notes: string | null;
}

export type ServerKind = "server" | "jbod" | "nas" | "switch" | "ups" | "other";
export interface Server {
  id: number;
  name: string;
  kind: ServerKind;
  vendor: string | null;
  model: string | null;
  serial: string | null;
  hostname: string | null;
  ip: string | null;
  os: string | null;
  cpu: string | null;
  ram_gb: number | null;
  rack_id: number | null;
  rack_u: number | null;
  height_u: number;
  bay_count: number;
  bay_rows: number;
  bay_form: "2.5" | "3.5" | "nvme";
  host_id: number | null;
  status: "active" | "standby" | "maintenance" | "offline" | "retired" | "planned";
  power_watts: number | null;
  purchase_date: string | null;
  warranty_until: string | null;
  price: number | null;
  notes: string | null;
}

export type Layout = "stripe" | "mirror" | "raidz1" | "raidz2" | "raidz3" | "draid1" | "draid2" | "draid3";
export interface Pool {
  id: number;
  name: string;
  server_id: number | null;
  status: "online" | "degraded" | "faulted" | "offline" | "migrating" | "planned" | "retired";
  layout: Layout;
  draid_data: number | null;
  draid_spares: number;
  color: number | null;
  ashift: number;
  compression: string;
  recordsize: string;
  encryption: boolean;
  dedup: boolean;
  used_gb: number | null;
  last_scrub: string | null;
  scrub_interval_days: number;
  last_snapshot: string | null;
  purpose: string | null;
  notes: string | null;
}

export type DiskRole = "data" | "spare" | "log" | "special" | "cache" | "dedup";
export type DiskStatus = "online" | "degraded" | "faulted" | "available" | "testing" | "failed" | "retired";
export interface Disk {
  id: number;
  serial: string;
  vendor: string | null;
  model: string | null;
  media: "hdd" | "ssd" | "nvme";
  interface: "sata" | "sas" | "nvme" | "usb";
  capacity_gb: number;
  rpm: number | null;
  form_factor: "2.5" | "3.5" | "m.2" | "u.2" | "pcie";
  sector_size: number;
  wwn: string | null;
  firmware: string | null;
  server_id: number | null;
  bay: number | null;
  pool_id: number | null;
  vdev: string | null;
  role: DiskRole;
  status: DiskStatus;
  smart_status: "passed" | "warning" | "failed" | "unknown";
  power_on_hours: number | null;
  temperature_c: number | null;
  reallocated_sectors: number | null;
  last_smart_test: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  price: number | null;
  notes: string | null;
}

export interface Service {
  id: number;
  name: string;
  kind: "vm" | "lxc" | "docker" | "app" | "share" | "backup" | "baremetal";
  server_id: number | null;
  status: "running" | "stopped" | "planned" | "retired";
  criticality: "low" | "medium" | "high" | "critical";
  url: string | null;
  ip: string | null;
  description: string | null;
  backup_policy: string | null;
  notes: string | null;
}

export interface ServicePool {
  id: number;
  service_id: number;
  pool_id: number;
  dataset: string | null;
  used_gb: number | null;
  access: "rw" | "ro";
  notes: string | null;
}

export type EventKind = "note" | "scrub" | "replace" | "failure" | "purchase" | "maintenance" | "migration" | "smart";
export interface LogEvent {
  id: number;
  at: string;
  kind: EventKind;
  title: string;
  body: string | null;
  disk_id: number | null;
  pool_id: number | null;
  server_id: number | null;
  service_id: number | null;
}

export interface State {
  racks: Rack[];
  servers: Server[];
  pools: Pool[];
  disks: Disk[];
  services: Service[];
  service_pools: ServicePool[];
  events: LogEvent[];
  settings: Record<string, unknown>;
}

export type Collection = Exclude<keyof State, "settings">;
export type Ref =
  | { type: "disk"; id: number }
  | { type: "server"; id: number }
  | { type: "pool"; id: number }
  | { type: "service"; id: number }
  | { type: "rack"; id: number };
