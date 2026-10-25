"use client";

import {
  Bell,
  Boxes,
  Database,
  FileStack,
  FileText,
  GitMerge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  Menu,
  PlusCircle,
  Siren,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ROLE_LABEL } from "@/lib/constants";
import { initials } from "@/lib/format";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "unread";
}

const NAV: Record<Role, { heading?: string; items: Item[] }[]> = {
  CITIZEN: [
    {
      items: [
        { href: "/me/complaints", label: "My complaints", icon: FileText },
        { href: "/report", label: "Report an issue", icon: PlusCircle },
        { href: "/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
    { heading: "City", items: [{ href: "/dashboard", label: "City dashboard", icon: Map }] },
  ],
  STAFF: [
    {
      items: [
        { href: "/staff/queue", label: "Work queue", icon: ListChecks },
        { href: "/staff/duplicates", label: "Duplicate review", icon: GitMerge },
        { href: "/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
    { heading: "City", items: [{ href: "/dashboard", label: "City dashboard", icon: Map }] },
  ],
  ADMIN: [
    {
      items: [
        { href: "/admin", label: "Overview", icon: LayoutDashboard },
        { href: "/admin/complaints", label: "All complaints", icon: FileStack },
        { href: "/admin/escalations", label: "Escalations", icon: Siren },
        { href: "/staff/duplicates", label: "Duplicate review", icon: GitMerge },
        { href: "/admin/users", label: "Users & roles", icon: Users },
        { href: "/notifications", label: "Notifications", icon: Bell, badge: "unread" },
      ],
    },
    {
      heading: "Database",
      items: [
        { href: "/admin/db-lab", label: "DB Lab", icon: Database },
        { href: "/admin/vector", label: "Vector console", icon: Boxes },
      ],
    },
  ],
};

interface NavProps {
  role: Role;
  name: string;
  scope: string;
  unread: number;
  signOut: () => Promise<void>;
}

function NavBody({ role, name, scope, unread, signOut, onNavigate }: NavProps & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Portal" className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV[role].map((group, gi) => (
          <div key={gi}>
            {group.heading && <p className="px-3 pb-1.5 text-[0.7rem] font-semibold tracking-wider text-rail-muted uppercase">{group.heading}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                        active ? "bg-[#f1eee7] font-medium text-[#14283c]" : "text-rail-foreground/85 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <item.icon className="size-[1.05rem]" strokeWidth={1.9} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === "unread" && unread > 0 && (
                        <span className={cn("rounded-full px-1.5 py-px font-mono text-[0.7rem] tabular-nums", active ? "bg-[#14283c] text-white" : "bg-[#d8901f] text-[#14283c]")}>
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <span aria-hidden className="grid size-9 place-items-center rounded-full bg-white/10 text-sm font-semibold">
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-rail-muted">{scope || ROLE_LABEL[role]}</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="icon-sm" className="text-rail-muted hover:bg-white/10 hover:text-white" aria-label="Sign out">
              <LogOut />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function RailNav(props: NavProps) {
  return <NavBody {...props} />;
}

export function MobilePortalBar(props: NavProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-rail px-4 text-rail-foreground lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="text-rail-foreground hover:bg-white/10 hover:text-white" aria-label="Open navigation">
            <Menu />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 border-none bg-rail p-0 text-rail-foreground">
          <SheetHeader className="px-5 pt-5">
            <SheetTitle asChild>
              <div>
                <Logo tone="paper" href="/" />
              </div>
            </SheetTitle>
          </SheetHeader>
          <NavBody {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Logo tone="paper" href="/" />
      {props.unread > 0 && (
        <Link href="/notifications" className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-white/10" aria-label={`${props.unread} unread notifications`}>
          <Bell className="size-4" aria-hidden />
          <span className="font-mono text-xs">{props.unread}</span>
        </Link>
      )}
    </div>
  );
}
