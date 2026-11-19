# ZFStack

ZFStack keeps track of the ZFS storage in a home lab: the disks you own, where each one sits, which pool and vdev it belongs to, and which services depend on it. It is a self-hosted web app backed by Postgres, styled with the Calepin design system and a violet accent.

## What it does

- **Rack view.** A front view of every rack, server and disk shelf. Each bay is a slot. Colour disks by pool, status, media, temperature or age. Click a disk for details, click an empty bay to add one, and drag disks between bays to move or swap them.
- **Inventory.** Disks, servers, pools and services, each with search, sorting and a detail panel. Export the disk list as CSV.
- **Pools.** Topology by vdev, with special, dedup, SLOG, L2ARC and spare vdevs. Usable capacity is estimated for stripe, mirror, RAIDZ1 to 3 and dRAID. Each pool shows its fault tolerance, scrub age and generated `zpool` commands.
- **Services.** Map VMs, containers, shares and backup jobs to the pools and datasets they use. Each disk then shows what breaks if it fails.
- **Dependencies.** Services, pools and enclosures side by side. Point at one to see its blast radius.
- **Health checks.** Faulted or degraded disks, SMART failures, reallocated sectors, heat, pools above 80%, overdue scrubs, missing spares, rack overlaps, warranties ending and 520-byte sector drives that need reformatting.
- **Disk replacement.** Pick a spare, and ZFStack swaps it into the old disk's bay, pool and vdev. It logs the change and shows the `zpool replace` command.
- **Log.** A maintenance journal. Replacements, scrubs and imports are logged automatically.
- **Tools.**
  - The capacity planner compares layouts for the same disks.
  - The TrueNAS import reads pools, vdevs, disks, temperatures, SMB and NFS shares and apps through the TrueNAS API.
  - The `zpool status` import parses pasted output.
- **Backups.** Download all data as JSON and restore it from Settings.
- Command menu (Ctrl K), light and dark themes (Ctrl Shift L), works on phones.

## Run it with Docker

```sh
docker compose up -d --build
```

Open http://localhost:8080. Set `ZFSTACK_PORT` to change the port and `POSTGRES_PASSWORD` to change the database password. Data lives in the `zfstack-db` volume.

ZFStack has no login. Keep it on your LAN or put it behind a reverse proxy with single sign-on, such as Pocket ID or Authelia.

## Develop

Requires Node 20 or newer and Docker.

```sh
npm install
cp .env.example .env
npm run db     # Postgres on localhost:5440
npm run dev    # API on :3000, web app on http://localhost:5173
npm test
npm run typecheck
```

The schema is created and migrated on start (`server/src/db.ts`). Add a new migration to the end of the list; never edit one that has been applied.

## TrueNAS import

In TrueNAS, open your user menu, then **API Keys**, and create a key. A read-only user is enough. In ZFStack go to **Tools**, then **Import from TrueNAS**, enter the address and key, preview, then import.

- ZFStack talks to TrueNAS from its own server, using the JSON-RPC WebSocket API (`/api/current`, TrueNAS 25.04+) and falling back to the REST API (`/api/v2.0`) on older versions.
- Use `https://`. TrueNAS 25.04 and later revoke an API key that is sent over plain HTTP. Tick **Accept self-signed certificate** for the default TrueNAS certificate.
- Pools and disks are matched by name and serial number. Your bays, criticality, prices and notes are kept. Disks that left a pool become available. New disks land on the shelf in the rack view, ready to drag into their bays.
- With **Remember this connection**, a **Sync TrueNAS** button appears on the Pools page. If you also store the key, it sits in plain text in the Postgres `settings` table. It is never sent to browsers or written into backups. Remove it with **Forget** on the import page.
- Nothing is ever changed on TrueNAS.

## Layout

```
server/src/   Fastify API: schema, CRUD, zpool parser, TrueNAS importer
web/src/      React app: views, components, ZFS capacity maths, health checks
```
