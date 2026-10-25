import Link from "next/link";
import { cn } from "@/lib/utils";

export function FilterTabs({ items, label }: { label: string; items: { label: string; href: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto border-b">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
            t.active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("rounded-full px-1.5 font-mono text-[0.7rem] tabular-nums", t.active ? "bg-primary text-primary-foreground" : "bg-muted")}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
