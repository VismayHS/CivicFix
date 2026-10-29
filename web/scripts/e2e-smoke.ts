/**
 * End-to-end smoke test against a running app (DATA_SOURCE=postgres).
 *
 *   npm run dev                       (in one terminal)
 *   npm run test:smoke                (in another; BASE_URL defaults to http://localhost:3000)
 *
 * Signs in as each role through the REST API, loads every page for that
 * role, and walks the main flows: file a complaint (auto-assignment +
 * duplicate detection in Qdrant), upvote, staff merges the duplicate,
 * admin runs the SLA sweep. It FILES ONE REAL COMPLAINT each run; reset
 * with `docker compose down -v && docker compose up -d` if that matters.
 */
export {};

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const QDRANT = (process.env.QDRANT_URL ?? "http://localhost:6333").replace(/\/$/, "");
const PASSWORD = "civicfix123"; // every seed account
let failures = 0;

function check(label: string, pass: boolean, detail = "") {
  console.log(`${pass ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!pass) failures++;
}

async function login(email: string): Promise<string> {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = r.headers
    .getSetCookie()
    .find((c) => c.startsWith("cf_session="))
    ?.split(";")[0];
  if (!r.ok || !cookie) throw new Error(`Sign-in failed for ${email}: ${r.status}`);
  return cookie;
}

async function api<T>(cookie: string | null, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const r = await fetch(`${BASE}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as T };
}

async function pages(role: string, cookie: string | null, paths: string[]) {
  for (const path of paths) {
    const t0 = Date.now();
    const r = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    const html = await r.text();
    const broken = /Application error|Internal Server Error|__next_error__/.test(html);
    check(`${role.padEnd(7)} page ${path}`, r.status === 200 && !broken, `${r.status}, ${Date.now() - t0} ms`);
  }
}

type Detail = {
  data: {
    complaint: { complaintId: number; status: string; wardId: number; assignedToName: string | null; filedByName: string };
    history: { changedByName: string }[];
    duplicateMatches: {
      complaint: { complaintId: number };
      matched: { complaintId: number };
      reviewStatus: string;
      similarityScore: number;
    }[];
  };
};

// ------------------------------------------------------------------ anon
const health = await api<{ ok: boolean; dataSource: string }>(null, "/health");
check("health on postgres", health.json?.ok === true && health.json.dataSource === "postgres", health.json?.dataSource);
await pages("anon", null, ["/", "/search", "/search?q=water", "/dashboard", "/track", "/track/37", "/login", "/register"]);
check("anon cannot list complaints", (await api(null, "/complaints")).status === 401);

// --------------------------------------------------------------- citizen
const citizen = await login("ananya@civicfix.test");
const report = {
  title: "Big pothole on the road near Sony World junction",
  description:
    "A deep pothole has opened in the middle of the road near Sony World junction. Bikes swerve into traffic to avoid it, and it fills with rain water.",
  wardId: 1,
};
const candidates = await api<{ data: { complaintId: number; score: number }[] }>(citizen, "/duplicates/check", report);
const top = candidates.json?.data?.[0];
check(
  "wizard finds the existing report before filing (Qdrant read)",
  !!top && [37, 172].includes(top.complaintId),
  top ? `#${top.complaintId} score ${top.score.toFixed(3)}` : "none",
);

const filed = await api<{ data: { complaintId: number } }>(citizen, "/complaints", { ...report, categoryId: 1 });
const id = filed.json?.data?.complaintId;
check("citizen files a complaint", filed.status >= 200 && filed.status < 300 && !!id, `#${id}`);
const mine = await api<Detail>(citizen, `/complaints/${id}`);
const c = mine.json?.data;
check("trigger auto-assigned it", c?.complaint.status === "ASSIGNED", c?.complaint.status);
check("citizen sees the assignee's name (vw_user_directory)", !!c?.complaint.assignedToName, c?.complaint.assignedToName ?? "null");
check("filing wrote history", (c?.history.length ?? 0) >= 2, `${c?.history.length} rows`);
await pages("citizen", citizen, ["/me/complaints", `/me/complaints/${id}`, "/report", "/notifications"]);

const up1 = await api<{ data: { upvoted: boolean; upvoteCount: number } }>(citizen, "/complaints/13/upvote", {});
const up2 = await api<{ data: { upvoted: boolean; upvoteCount: number } }>(citizen, "/complaints/13/upvote", {});
check("upvote toggles on and off", up1.json?.data?.upvoted !== up2.json?.data?.upvoted && up1.status === 200 && up2.status === 200);
check("citizen cannot upvote own complaint", (await api(citizen, `/complaints/${id}/upvote`, {})).status >= 400);
check("citizen cannot open someone else's complaint", (await api(citizen, "/complaints/13")).status === 404);

// ----------------------------------------------------------------- staff
const staff = await login("ravi.kumar@civicfix.test");
const seen = await api<Detail>(staff, `/complaints/${id}`);
const match = seen.json?.data?.duplicateMatches.find((m) => m.complaint.complaintId === id && m.reviewStatus === "PENDING");
check(
  "staff sees the filer's name (vw_user_directory)",
  seen.json?.data?.complaint.filedByName === "Ananya Rao",
  seen.json?.data?.complaint.filedByName,
);
check(
  "filing recorded a PENDING duplicate match",
  !!match,
  match ? `~#${match.matched.complaintId} score ${match.similarityScore.toFixed(3)}` : "none",
);
await pages("staff", staff, ["/staff/queue", `/staff/complaints/${id}`, "/staff/duplicates", "/notifications"]);
if (match) {
  const review = await api(staff, `/duplicates/${id}/${match.matched.complaintId}/review`, { decision: "CONFIRMED" });
  const after = await api<Detail>(staff, `/complaints/${id}`);
  check(
    "staff merges the duplicate (sp_confirm_duplicate)",
    review.status === 200 && after.json?.data?.complaint.status === "DUPLICATE",
    after.json?.data?.complaint.status,
  );
  const point = (await fetch(`${QDRANT}/collections/complaints/points/${id}`).then((r) => r.json())) as {
    result?: { payload?: { is_open?: boolean; status?: string } };
  };
  check("Qdrant payload updated after the merge", point.result?.payload?.is_open === false, `${point.result?.payload?.status}`);
}
check("staff cannot run the SLA sweep", (await api(staff, "/escalations/sweep", {})).status === 403);

// ----------------------------------------------------------------- admin
const admin = await login("commissioner@civicfix.test");
await pages("admin", admin, [
  "/admin",
  "/admin/complaints",
  `/admin/complaints/${id}`,
  "/admin/escalations",
  "/admin/users",
  "/admin/db-lab",
  "/admin/vector",
  "/notifications",
]);
const sweep = await api<{ data: { escalated: number } }>(admin, "/escalations/sweep", {});
check("admin runs the SLA sweep (sp_escalate_overdue)", sweep.status === 200, `escalated ${sweep.json?.data?.escalated}`);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
