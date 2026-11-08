/**
 * Demo-day preflight. Checks everything an evaluator will touch and says how
 * to fix whatever is wrong. Read-only: changes nothing.
 *
 *   npm run demo:check                       app on http://localhost:3000
 *   BASE_URL=http://localhost:3100 npm run demo:check
 *
 * Exit code 1 if any check fails.
 */
import { spawnSync } from "node:child_process";
import { asAdmin } from "./_db.ts";
import { COLLECTION, qdrant } from "../src/lib/vector/core.ts";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const PASSWORD = "civicfix123";
let failures = 0;

function check(label: string, pass: boolean, detail = "", fix = "") {
  console.log(
    `${pass ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`,
  );
  if (!pass) {
    failures++;
    if (fix) console.log(`      fix: ${fix}`);
  }
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

// 1. PostgreSQL ------------------------------------------------------------
type Facts = {
  complaints: number;
  indexable: number;
  users: number;
  unsynced: number;
  rls_tables: number;
  roles: number;
  open_states: number;
};

// civic_admin cannot read the cron schema or schema_migrations (least privilege),
// so ask the container as the postgres superuser instead.
function superuser(sql: string): number | null {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "civicfix-db",
      "psql",
      "-U",
      "postgres",
      "-d",
      "civicfix",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  );
  const n = Number(r.stdout.trim());
  return r.status === 0 && Number.isFinite(n) ? n : null;
}
const db = await attempt(() =>
  asAdmin(async (c) => {
    const { rows } = await c.query<Facts>(`
      SELECT (SELECT count(*) FROM complaint)::int                                       AS complaints,
             -- a withdrawn complaint stays in Postgres but is deleted from Qdrant on purpose
             (SELECT count(*) FROM complaint c WHERE NOT EXISTS (
                SELECT 1 FROM status_history h WHERE h.complaint_id = c.complaint_id AND h.remarks = 'Withdrawn by citizen'))::int AS indexable,
             (SELECT count(*) FROM app_user)::int                                         AS users,
             (SELECT count(*) FROM complaint WHERE vector_synced_at IS NULL)::int         AS unsynced,
             (SELECT count(*) FROM pg_class WHERE relrowsecurity)::int                    AS rls_tables,
             (SELECT count(*) FROM pg_roles WHERE rolname IN ('civic_app','civic_citizen','civic_staff','civic_admin'))::int AS roles,
             (SELECT count(*) FROM complaint WHERE status NOT IN ('RESOLVED','CLOSED','DUPLICATE'))::int AS open_states`);
    return rows[0];
  }),
);
const reset =
  "docker compose up -d   (or, for a clean start: npm run demo:reset)";
check("PostgreSQL answers as civic_app -> civic_admin", db !== null, "", reset);
if (db) {
  const migrations = superuser("SELECT count(*) FROM schema_migrations");
  const jobs = superuser("SELECT count(*) FROM cron.job");
  check(
    "9 migrations applied",
    migrations === null || migrations >= 9,
    migrations === null ? "docker not reachable, skipped" : `${migrations}`,
    "npm run demo:reset",
  );
  check(
    "seed data present",
    db.complaints >= 176 && db.users >= 56,
    `${db.complaints} complaints, ${db.users} users`,
    "npm run demo:reset",
  );
  check(
    "4 pg_cron jobs registered",
    jobs === null || jobs === 4,
    jobs === null ? "docker not reachable, skipped" : `${jobs}`,
    "npm run demo:reset",
  );
  check(
    "row-level security enabled on 9 tables",
    db.rls_tables >= 9,
    `${db.rls_tables}`,
    "npm run demo:reset",
  );
  check(
    "4 database roles exist",
    db.roles === 4,
    `${db.roles}`,
    "npm run demo:reset",
  );
  check(
    "enough open complaints to demo the workflow",
    db.open_states >= 25,
    `${db.open_states} open`,
    "The data is used up. npm run demo:reset",
  );
}

// 2. Qdrant ----------------------------------------------------------------
type Info = {
  result: {
    points_count: number;
    config: { params: { vectors: { size: number; distance: string } } };
  };
};
const info = await attempt(() => qdrant<Info>(`/collections/${COLLECTION}`));
check(
  "Qdrant collection exists (384-d, Cosine)",
  info?.result?.config?.params?.vectors?.size === 384 &&
    info.result.config.params.vectors.distance === "Cosine",
  "",
  "npm run vector:setup && npm run vector:reindex",
);
if (info && db) {
  check(
    "Qdrant holds every complaint that was not withdrawn",
    info.result.points_count === db.indexable,
    `${info.result.points_count} points, ${db.indexable} complaints that were not withdrawn`,
    "npm run vector:reindex",
  );
  check(
    "no complaint waiting to be synced",
    db.unsynced === 0,
    `${db.unsynced} unsynced`,
    "npm run vector:reindex -- --missing",
  );
}

// 3. The web app -----------------------------------------------------------
const home = await attempt(() => fetch(`${BASE}/api/v1/health`));
const health = home?.ok
  ? ((await home.json().catch(() => null)) as {
      ok?: boolean;
      dataSource?: string;
    } | null)
  : null;
check(
  `CivicFix answers at ${BASE}`,
  health?.ok === true,
  home ? `HTTP ${home.status}` : "no response",
  home && home.status === 404
    ? "Another program owns this port (Grafana on 3000?). Stop it, or use another port and set BASE_URL."
    : "cd web && npm run build && npx next start -p 3000",
);
check(
  "app is using the real PostgreSQL backend, not the mock",
  health?.dataSource === "postgres",
  `dataSource=${health?.dataSource ?? "unknown"}`,
  "Set DATA_SOURCE=postgres in web/.env.local and restart the app",
);

const accounts: [string, string][] = [
  ["citizen", "ananya@civicfix.test"],
  ["staff", "ravi.kumar@civicfix.test"],
  ["admin", "commissioner@civicfix.test"],
];
if (health?.ok) {
  for (const [role, email] of accounts) {
    const r = await attempt(() =>
      fetch(`${BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
    const cookie = r?.headers
      .getSetCookie()
      .some((c) => c.startsWith("cf_session="));
    check(
      `${role} can sign in`,
      !!r?.ok && !!cookie,
      r ? `HTTP ${r.status}` : "no response",
      r?.status === 404
        ? "Another program owns this port (Grafana on 3000?). Stop it, or use another port and set BASE_URL."
        : "npm run demo:reset",
    );
  }
  const dup = await attempt(async () => {
    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: accounts[0][1], password: PASSWORD }),
    });
    const cookie =
      login.headers
        .getSetCookie()
        .find((c) => c.startsWith("cf_session="))
        ?.split(";")[0] ?? "";
    const res = await fetch(`${BASE}/api/v1/duplicates/check`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "Big pothole on the road near Sony World junction",
        description:
          "A deep pothole has opened in the middle of the road near Sony World junction. Bikes swerve into traffic to avoid it, and it fills with rain water.",
        wardId: 1,
      }),
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as { data?: unknown[] } | null,
    };
  });
  if (dup && dup.status !== 404) {
    check(
      "duplicate detection finds the pothole report",
      dup.status === 200 && (dup.body?.data?.length ?? 0) > 0,
      `HTTP ${dup.status}, ${dup.body?.data?.length ?? 0} suggestion(s)`,
      "npm run vector:reindex -- --missing",
    );
  }
}

console.log(
  failures === 0
    ? "\nReady for the demo."
    : `\n${failures} check(s) failed. Fix them in the order shown.`,
);
process.exit(failures === 0 ? 0 : 1);
