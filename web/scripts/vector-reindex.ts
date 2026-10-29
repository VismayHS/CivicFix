/**
 * Embeds complaints from Postgres and upserts them into Qdrant in batches
 * of 32, then marks each row with complaint.vector_synced_at.
 *
 *   npm run vector:reindex              every complaint
 *   npm run vector:reindex -- --missing only rows with vector_synced_at IS NULL
 *                                       (uses the partial index idx_complaint_unsynced)
 *
 * SQL stays the source of truth: if Qdrant fails, the rows simply stay
 * unsynced and the next --missing run picks them up.
 */
import { asAdmin } from "./_db.ts";
import { type ComplaintRow, ensureCollection, upsertComplaints } from "../src/lib/vector/core.ts";

const missingOnly = process.argv.includes("--missing");
const BATCH = 32;

const rows = await asAdmin(
  async (c) =>
    (
      await c.query<ComplaintRow>(
        `SELECT complaint_id, title, description, ward_id, category_id, department_id, status, created_at
     FROM complaint ${missingOnly ? "WHERE vector_synced_at IS NULL" : ""} ORDER BY complaint_id`,
      )
    ).rows,
);
console.log(`${rows.length} complaint(s) to index${missingOnly ? " (missing only)" : ""}. Loading the embedding model…`);

await ensureCollection();
let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  await upsertComplaints(batch);
  await asAdmin(async (c) => {
    for (const r of batch) await c.query("SELECT fn_mark_vector_synced($1, true)", [r.complaint_id]);
  });
  done += batch.length;
  console.log(`  ${done}/${rows.length}`);
}
console.log("Done.");
