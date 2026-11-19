// Runs the API (tsx watch) and the Vite dev server side by side.
import { spawn } from "node:child_process";

const run = (script) =>
  spawn("npm", ["run", script], { stdio: "inherit", shell: true });

const procs = [run("dev:server"), run("dev:web")];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
