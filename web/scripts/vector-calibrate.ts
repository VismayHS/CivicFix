/**
 * Calibrates DUPLICATE_THRESHOLD for real MiniLM cosine scores.
 *
 *   npm run vector:calibrate
 *
 * Positives: the seeded re-reports (every duplicate_match pair).
 * Negatives: the pairs the live search could actually compare: same ward
 *   (the search filters by ward) and filed within 60 days of each other
 *   (the search only looks back 60 days). Split into
 *     hard = same category (e.g. two different potholes in one ward)
 *     easy = different category.
 *   Pairs with the identical title or description are left out as
 *   ambiguous: the demo seed reuses text templates, so these are the same
 *   issue reported again, not true negatives.
 * For each threshold it prints recall on positives, how many negative pairs
 * would be flagged, precision, F1 and F2. We pick the best F2 (recall
 * weighted twice as much as precision): a flag only asks staff to review a
 * pair, so a missed duplicate costs more than a false flag.
 * Results are written up in docs/database/vector-db.md.
 */
import { asAdmin } from "./_db.ts";
import { complaintText, dot, embedMany } from "../src/lib/vector/core.ts";
import { DUPLICATE_THRESHOLD } from "../src/lib/constants.ts";

type C = { complaint_id: number; title: string; description: string; ward_id: number; category_id: number; created_at: Date };

const { complaints, matches } = await asAdmin(async (c) => ({
  complaints: (
    await c.query<C>("SELECT complaint_id, title, description, ward_id, category_id, created_at FROM complaint ORDER BY complaint_id")
  ).rows,
  matches: (
    await c.query<{ a: number; b: number; status: string }>(
      "SELECT complaint_id AS a, matched_complaint_id AS b, review_status AS status FROM duplicate_match",
    )
  ).rows,
}));

console.log(`Embedding ${complaints.length} complaints…`);
const vectors = new Map<number, number[]>();
const embedded = await embedMany(complaints.map((c) => complaintText(c.title, c.description)));
complaints.forEach((c, i) => vectors.set(c.complaint_id, embedded[i]));
const score = (a: number, b: number) => dot(vectors.get(a)!, vectors.get(b)!);

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const positiveKeys = new Set(matches.map((m) => key(m.a, m.b)));
const positives = matches.map((m) => ({ ...m, score: score(m.a, m.b) }));

const hard: number[] = [];
const easy: number[] = [];
let ambiguous = 0;
const SIXTY_DAYS = 60 * 86_400_000;
for (let i = 0; i < complaints.length; i++) {
  for (let j = i + 1; j < complaints.length; j++) {
    const x = complaints[i],
      y = complaints[j];
    if (x.ward_id !== y.ward_id || positiveKeys.has(key(x.complaint_id, y.complaint_id))) continue;
    if (Math.abs(x.created_at.getTime() - y.created_at.getTime()) > SIXTY_DAYS) continue;
    if (x.title === y.title || x.description === y.description) {
      ambiguous++;
      continue;
    }
    (x.category_id === y.category_id ? hard : easy).push(score(x.complaint_id, y.complaint_id));
  }
}

const r3 = (n: number) => n.toFixed(3);
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length}  min ${r3(s[0])}  median ${r3(q(0.5))}  p95 ${r3(q(0.95))}  max ${r3(s[s.length - 1])}`;
};

console.log("\nScore distributions (cosine similarity)");
console.log(`  seeded duplicates     ${stats(positives.map((p) => p.score))}`);
console.log(`  same ward, same cat   ${stats(hard)}`);
console.log(`  same ward, other cat  ${stats(easy)}`);
console.log(`  (left out ${ambiguous} same-ward pairs with identical text: repeat reports of one issue)`);

console.log("\nSeeded pairs");
for (const p of positives.sort((a, b) => a.score - b.score)) {
  const t = (id: number) => complaints.find((c) => c.complaint_id === id)!.title;
  console.log(`  ${r3(p.score)}  ${p.status.padEnd(9)} #${p.a} "${t(p.a)}"  ~  #${p.b} "${t(p.b)}"`);
}

type Row = { t: number; recall: number; hardFp: number; easyFp: number; precision: number; f1: number; f2: number };
const rows: Row[] = [];
for (let t = 0.4; t <= 0.951; t += 0.01) {
  const tp = positives.filter((p) => p.score >= t).length;
  const hardFp = hard.filter((s) => s >= t).length;
  const easyFp = easy.filter((s) => s >= t).length;
  const recall = tp / positives.length;
  const precision = tp + hardFp + easyFp ? tp / (tp + hardFp + easyFp) : 1;
  const fBeta = (b: number) => (precision + recall ? ((1 + b * b) * precision * recall) / (b * b * precision + recall) : 0);
  rows.push({ t, recall, hardFp, easyFp, precision, f1: fBeta(1), f2: fBeta(2) });
}
const best = rows.reduce((a, b) => (b.f1 > a.f1 ? b : a));
const chosen = rows.reduce((a, b) => (b.f2 > a.f2 ? b : a));

console.log("\n| threshold | recall | false flags (same cat) | false flags (other cat) | precision | F1 | F2 |");
console.log("|---|---|---|---|---|---|---|");
for (const r of rows.filter((r) => Math.round(r.t * 100) % 5 === 0 || r === best || r === chosen)) {
  const tag = r === chosen ? " **(best F2)**" : r === best ? " (best F1)" : "";
  console.log(`| ${r.t.toFixed(2)}${tag} | ${r3(r.recall)} | ${r.hardFp} | ${r.easyFp} | ${r3(r.precision)} | ${r3(r.f1)} | ${r3(r.f2)} |`);
}
console.log(
  `\nBest F2 ${r3(chosen.f2)} at ${chosen.t.toFixed(2)}; best F1 ${r3(best.f1)} at ${best.t.toFixed(2)}. Current DUPLICATE_THRESHOLD = ${DUPLICATE_THRESHOLD}.`,
);
