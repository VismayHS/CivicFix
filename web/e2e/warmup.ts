import { request } from "@playwright/test";
import { ACCOUNTS, PASSWORD } from "./helpers";

/**
 * Loads the embedding model once before the first test. On a freshly started
 * server the first duplicate check pulls MiniLM into memory and keeps the Node
 * process busy for several seconds, which made whichever test ran first flaky.
 */
export default async function warmup() {
  const api = await request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3000" });
  await api.post("/api/v1/auth/login", { data: { email: ACCOUNTS.citizen, password: PASSWORD } });
  await api.post("/api/v1/duplicates/check", {
    data: { title: "Warm-up check", description: "Water leaking from a burst pipe on the main road.", wardId: 1 },
    timeout: 120_000,
  });
  await api.dispose();
}
