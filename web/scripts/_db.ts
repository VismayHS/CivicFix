/**
 * Database access for the command-line scripts. Connects with DATABASE_URL
 * (civic_app, from .env.local) and switches to civic_admin as the
 * commissioner would, so the scripts obey the same GRANTs and RLS as the app.
 */
import pg from "pg";

export async function asAdmin<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Run from web/ so .env.local is loaded.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE civic_admin");
    // app.ward_id empty = city-wide admin; app.role ADMIN lets fn_mark_vector_synced run.
    await client.query(
      "SELECT set_config('app.role','ADMIN',true), set_config('app.user_id','',true), set_config('app.ward_id','',true), set_config('app.department_id','',true)",
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
