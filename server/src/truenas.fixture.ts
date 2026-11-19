/** A TrueNAS SCALE-shaped snapshot used by tests and the mock server. */
const leaf = (disk: string, status = "ONLINE") => ({ type: "DISK", disk, device: `${disk}1`, status, children: [] });

export const FIXTURE = {
  info: {
    hostname: "truenas.lab", version: "25.10.0", model: "Intel(R) Xeon(R) CPU E3-1240 v6", physmem: 68719476736,
    system_manufacturer: "Supermicro", system_product: "SYS-5019S-M", system_serial: "S2170481",
  },
  pools: [
    {
      name: "movies", status: "DEGRADED", healthy: false, allocated: 15e12,
      scan: { function: "SCRUB", state: "FINISHED", end_time: { $date: Date.UTC(2026, 10, 9, 3, 0) } },
      topology: {
        data: [{ type: "RAIDZ1", name: "raidz1-0", status: "DEGRADED", children: [leaf("sda"), leaf("sdb"), leaf("sdc", "FAULTED"), { type: "DISK", disk: null, device: null, status: "UNAVAIL", children: [] }] }],
        log: [], cache: [{ type: "DISK", disk: "nvme0n1", device: "nvme0n1p1", status: "ONLINE", children: [] }],
        spare: [leaf("sdd", "AVAIL")], special: [], dedup: [],
      },
    },
    {
      name: "fast", status: "ONLINE", healthy: true, allocated: 2e11, scan: null,
      topology: {
        data: [
          { type: "MIRROR", name: "mirror-0", status: "ONLINE", children: [leaf("sde"), leaf("sdf")] },
          { type: "MIRROR", name: "mirror-1", status: "ONLINE", children: [leaf("sdg"), leaf("sdh")] },
        ],
        log: [], cache: [], spare: [], special: [{ type: "MIRROR", name: "mirror-2", status: "ONLINE", children: [leaf("sdi"), leaf("sdj")] }], dedup: [],
      },
    },
  ],
  disks: [
    ...["sda", "sdb", "sdc", "sdd"].map((n, i) => ({ name: n, serial: `ZL2A${i}`, size: 8001563222016, model: "ST8000VN004", type: "HDD", rotationrate: 7200, bus: "SCSI", lunid: `5000c500a${i}` })),
    ...["sde", "sdf", "sdg", "sdh"].map((n, i) => ({ name: n, serial: `S4EV${i}`, size: 1000204886016, model: "Samsung SSD 870 EVO 1TB", type: "SSD", rotationrate: null, bus: "SCSI" })),
    ...["sdi", "sdj"].map((n, i) => ({ name: n, serial: `OPT${i}`, size: 118410444800, model: "INTEL SSDPED1K120GA", type: "SSD", rotationrate: null, bus: "SCSI" })),
    { name: "nvme0n1", serial: "NVMECACHE", size: 512110190592, model: "WD Black SN770", type: "SSD", rotationrate: null, bus: "NVME" },
    { name: "sdk", serial: "UNUSED1", size: 4000787030016, model: "WD40EFRX", type: "HDD", rotationrate: 5400, bus: "SCSI" },
  ],
  datasets: {
    movies: { id: "movies", used: { parsed: 14.2e12 }, compression: { value: "LZ4" }, recordsize: { value: "1M" }, encrypted: false, deduplication: { value: "OFF" } },
    fast: { id: "fast", used: { parsed: 3.1e11 }, compression: { value: "ZSTD" }, recordsize: { value: "128K" }, encrypted: true, deduplication: { value: "OFF" } },
  },
  temps: { sda: 38, sdb: 39, sdc: 51, sdd: 30, sde: 32 },
  smb: [{ name: "media", path: "/mnt/movies/library", enabled: true, ro: false, comment: "" }],
  nfs: [{ path: "/mnt/fast/vm", enabled: true, ro: false, comment: "Proxmox VM storage" }],
  apps: [{ name: "jellyfin", state: "RUNNING", metadata: { title: "Jellyfin" }, active_workloads: { volumes: [{ source: "/mnt/movies/library", destination: "/media" }, { source: "/mnt/.ix-apps/app_mounts/jellyfin/config", destination: "/config" }] } }],
  docker: { pool: "fast" },
};
