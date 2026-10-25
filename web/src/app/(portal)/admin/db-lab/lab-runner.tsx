"use client";

import { Copy, Play } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { runLabQuery } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";
import type { LabQuery, LabResult } from "@/lib/types";
import { cn } from "@/lib/utils";

export function LabRunner({ queries, source }: { queries: LabQuery[]; source: "mock" | "postgres" }) {
  const [selectedId, setSelectedId] = useState(queries[0]?.id);
  const [results, setResults] = useState<Record<string, LabResult>>({});
  const [pending, start] = useTransition();
  const q = queries.find((x) => x.id === selectedId) ?? queries[0];
  const result = q ? results[q.id] : undefined;

  const run = () =>
    start(async () => {
      const res = await runLabQuery(q.id);
      if (res.ok && res.data) setResults((r) => ({ ...r, [q.id]: res.data! }));
      else if (!res.ok) toast.error(res.error);
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <nav aria-label="Queries" className="lg:sticky lg:top-8 lg:self-start">
        <ul className="space-y-1">
          {queries.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSelectedId(x.id)}
                aria-current={x.id === q.id ? "true" : undefined}
                className={cn("w-full rounded-md px-3 py-2 text-left transition-colors", x.id === q.id ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                <span className="block text-sm font-medium">{x.title}</span>
                <span className={cn("block text-xs", x.id === q.id ? "text-primary-foreground/75" : "text-muted-foreground")}>{x.rubricItem}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-5">
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">{q.title}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{q.description}</p>
              <p className="mt-2 inline-flex rounded bg-info-soft px-2 py-0.5 text-xs font-medium text-info">{q.concept}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(q.sql);
                  toast.success("SQL copied");
                }}
              >
                <Copy data-icon="inline-start" /> Copy SQL
              </Button>
              <Button size="sm" onClick={run} disabled={pending}>
                <Play data-icon="inline-start" /> {pending ? "Running…" : "Run"}
              </Button>
            </div>
          </div>
          <pre className="overflow-x-auto bg-[#101b29] px-5 py-4 font-mono text-[0.8rem] leading-relaxed text-[#e5e9f0]">
            <code>{q.sql}</code>
          </pre>
        </div>

        {result ? (
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3 text-sm">
              <span className="font-medium">
                {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {result.elapsedMs} ms · {result.source === "mock" ? "mock data (same result shape as PostgreSQL)" : "PostgreSQL"}
              </span>
            </div>
            {result.rowCount === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">The query ran and returned no rows for the current data.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} scope="col" className="px-4 py-2 text-left font-mono text-xs font-medium whitespace-nowrap text-muted-foreground">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[0.8rem]">
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-t">
                        {row.map((cell, j) => (
                          <td key={j} className={cn("px-4 py-2 whitespace-nowrap", typeof cell === "number" && "text-right tabular-nums")}>
                            {cell === null ? <span className="text-muted-foreground italic">null</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
            Press Run to execute this query{source === "mock" ? " against the mock dataset" : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
