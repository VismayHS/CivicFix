import Link from "next/link";
import type { ComplaintSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ComplaintRef } from "./complaint-ref";
import { SlaBar } from "./sla-bar";
import { EscalationTag, PriorityTag, StatusBadge } from "./status-badge";

type Column = "ward" | "department" | "assignee" | "upvotes" | "sla" | "category";

interface Props {
  complaints: ComplaintSummary[];
  hrefFor: (c: ComplaintSummary) => string;
  columns?: Column[];
  className?: string;
}

/** Shared list for citizen, staff and admin views. Rows are whole-row links. */
export function ComplaintTable({ complaints, hrefFor, columns = ["category", "ward", "sla"], className }: Props) {
  return (
    <>
      {/* Phones: stacked cards instead of a sideways-scrolling table */}
      <ul className={cn("divide-y rounded-lg border bg-card md:hidden", className)}>
        {complaints.map((c) => (
          <li key={c.complaintId}>
            <Link href={hrefFor(c)} className="block space-y-2 px-4 py-3.5 active:bg-accent/50">
              <span className="flex flex-wrap items-center gap-2">
                <ComplaintRef id={c.complaintId} />
                <StatusBadge status={c.status} />
                <PriorityTag priority={c.priority} />
                <EscalationTag level={c.escalationLevel} />
              </span>
              <span className="block font-medium">{c.title}</span>
              <span className="block text-xs text-muted-foreground">
                {c.categoryName} · {c.wardName}
                {columns.includes("assignee") && ` · ${c.assignedToName ?? "Unassigned"}`}
                {columns.includes("upvotes") && ` · ${c.upvoteCount} upvotes`}
              </span>
              {columns.includes("sla") && <SlaBar complaint={c} />}
            </Link>
          </li>
        ))}
      </ul>
      <div className={cn("hidden overflow-x-auto rounded-lg border bg-card md:block", className)}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-left text-xs font-medium text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">Complaint</th>
              {columns.includes("category") && <th scope="col" className="px-3 py-2.5 font-medium">Category</th>}
              {columns.includes("ward") && <th scope="col" className="px-3 py-2.5 font-medium">Ward</th>}
              {columns.includes("department") && <th scope="col" className="px-3 py-2.5 font-medium">Department</th>}
              {columns.includes("assignee") && <th scope="col" className="px-3 py-2.5 font-medium">Assigned to</th>}
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              {columns.includes("sla") && <th scope="col" className="w-56 px-3 py-2.5 font-medium">SLA clock</th>}
              {columns.includes("upvotes") && <th scope="col" className="px-4 py-2.5 text-right font-medium">Upvotes</th>}
            </tr>
          </thead>
          <tbody>
            {complaints.map((c) => (
              <tr key={c.complaintId} className="group relative border-b last:border-0 hover:bg-accent/40 focus-within:bg-accent/40">
                <td className="max-w-[22rem] px-4 py-3">
                  <Link href={hrefFor(c)} className="after:absolute after:inset-0 focus-visible:outline-none">
                    <span className="flex items-center gap-2">
                      <ComplaintRef id={c.complaintId} />
                      <PriorityTag priority={c.priority} />
                      <EscalationTag level={c.escalationLevel} />
                    </span>
                    <span className="mt-0.5 block truncate font-medium group-hover:underline">{c.title}</span>
                  </Link>
                </td>
                {columns.includes("category") && <td className="px-3 py-3 text-foreground/80">{c.categoryName}</td>}
                {columns.includes("ward") && <td className="px-3 py-3 whitespace-nowrap text-foreground/80">{c.wardName}</td>}
                {columns.includes("department") && <td className="px-3 py-3 text-foreground/80">{c.departmentName}</td>}
                {columns.includes("assignee") && <td className="px-3 py-3 whitespace-nowrap text-foreground/80">{c.assignedToName ?? <span className="text-muted-foreground">Unassigned</span>}</td>}
                <td className="px-3 py-3">
                  <StatusBadge status={c.status} />
                </td>
                {columns.includes("sla") && (
                  <td className="px-3 py-3">
                    <SlaBar complaint={c} />
                  </td>
                )}
                {columns.includes("upvotes") && <td className="px-4 py-3 text-right font-mono tabular-nums">{c.upvoteCount}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
