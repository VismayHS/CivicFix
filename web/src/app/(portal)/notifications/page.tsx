import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { NOTIFICATION_LABEL } from "@/lib/constants";
import { data } from "@/lib/data";
import { formatDate, formatShortDateTime } from "@/lib/format";
import type { NotificationType, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MarkAllRead } from "./mark-all-read";

export const metadata: Metadata = { title: "Notifications" };

const TONE: Record<NotificationType, string> = {
  ASSIGNMENT: "bg-info",
  STATUS_UPDATE: "bg-ok",
  ESCALATION: "bg-danger",
  DUPLICATE_FLAG: "bg-dup",
  SYSTEM: "bg-foreground/40",
};

const BASE: Record<Role, string> = { CITIZEN: "/me/complaints", STAFF: "/staff/complaints", ADMIN: "/admin/complaints" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const user = await requireUser();
  const items = await data.listNotifications(user);
  const unread = items.filter((n) => !n.readStatus).length;
  const groups = new Map<string, typeof items>();
  for (const n of items) {
    const key = formatDate(n.sentAt);
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return (
    <div className="space-y-8">
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread. Assignments, status changes, escalations and duplicate flags appear here.` : "You're all caught up."}
        actions={unread > 0 ? <MarkAllRead /> : null}
      />
      {items.length === 0 ? (
        <EmptyState icon={BellOff} title="No notifications yet">Updates about your complaints will appear here.</EmptyState>
      ) : (
        <div className="space-y-8">
          {[...groups].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{day}</h2>
              <ul className="divide-y rounded-lg border bg-card">
                {list.map((n) => {
                  const body = (
                    <div className={cn("flex gap-3 px-4 py-3.5", !n.readStatus && "bg-info-soft/40")}>
                      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE[n.type], n.readStatus && "opacity-35")} />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm", !n.readStatus && "font-medium")}>{n.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {NOTIFICATION_LABEL[n.type]} · {formatShortDateTime(n.sentAt)}
                          {!n.readStatus && <span className="sr-only"> · unread</span>}
                        </p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.notificationId}>
                      {n.complaintId ? (
                        <Link href={`${BASE[user.role]}/${n.complaintId}`} className="block transition-colors hover:bg-accent/40">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
