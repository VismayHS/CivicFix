/**
 * Puts the demo back to a clean state: fresh PostgreSQL (migrations 001 to 009
 * + seed) and a fresh Qdrant collection with every complaint indexed.
 * DELETES all local data in both databases, then runs the preflight.
 *
 *   npm run demo:reset
 *
 * Takes about a minute. Stop the web app first if it is running, then start
 * it again afterwards (the app keeps no data of its own).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const web = resolve(root, "web");
const nodeFlags = [
  "--env-file-if-exists=.env.local",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];

function run(label: string, cmd: string, args: string[], cwd = root): boolean {
  console.log(`\n> ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0)
    console.log(`  (${label} exited with ${r.status ?? r.error?.message})`);
  return r.status === 0;
}

function capture(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: false });
  return r.status === 0 ? r.stdout.trim() : "";
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

if (
  !run("docker compose down -v (deletes the local data)", "docker", [
    "compose",
    "down",
    "-v",
  ])
) {
  console.error(
    "Docker is not reachable. Start Docker Desktop, wait for it to say 'running', then retry.",
  );
  process.exit(1);
}
if (!run("docker compose up -d", "docker", ["compose", "up", "-d"]))
  process.exit(1);

console.log("\n> waiting for the database to load the migrations and the seed");
let seeded = false;
for (let i = 0; i < 60 && !seeded; i++) {
  const n = capture("docker", [
    "exec",
    "civicfix-db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "civicfix",
    "-Atc",
    "SELECT count(*) FROM complaint",
  ]);
  seeded = Number(n) >= 176;
  if (!seeded) await sleep(3000);
}
if (!seeded) {
  console.error(
    "The database did not finish seeding in 3 minutes. Run `docker compose logs db` to see why.",
  );
  process.exit(1);
}
console.log("  database ready");

console.log("\n> waiting for Qdrant");
let qdrantUp = false;
for (let i = 0; i < 30 && !qdrantUp; i++) {
  qdrantUp = await fetch("http://localhost:6333/readyz").then(
    (r) => r.ok,
    () => false,
  );
  if (!qdrantUp) await sleep(2000);
}
if (!qdrantUp) {
  console.error("Qdrant did not start. Run `docker compose logs qdrant`.");
  process.exit(1);
}

const ok =
  run(
    "vector:setup",
    process.execPath,
    [...nodeFlags, "scripts/vector-setup.ts"],
    web,
  ) &&
  run(
    "vector:reindex (the first run downloads the embedding model, then about 30 s)",
    process.execPath,
    [...nodeFlags, "scripts/vector-reindex.ts"],
    web,
  );
if (!ok) process.exit(1);

// The app is not part of the reset: it may be down. Check only the databases.
const check = spawnSync(
  process.execPath,
  [...nodeFlags, "scripts/demo-check.ts"],
  {
    cwd: web,
    stdio: "inherit",
    env: {
      ...process.env,
      BASE_URL: process.env.BASE_URL ?? "http://localhost:3000",
    },
  },
);
console.log(
  check.status === 0
    ? "\nClean state restored."
    : "\nDatabases are reset. Any 'app answers' failure above just means the web app is not running yet:\n  cd web && npm run build && npx next start -p 3000",
);
