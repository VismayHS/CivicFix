import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="28" height="28" rx="6" fill="currentColor" />
      <path
        d="M14 6.5c-3.3 0-6 2.6-6 5.9 0 4.2 6 9.6 6 9.6s6-5.4 6-9.6c0-3.3-2.7-5.9-6-5.9Z"
        fill="var(--paper)"
      />
      <path d="m11.3 12.4 1.9 1.9 3.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="5.5" r="2.5" fill="#d8901f" />
    </svg>
  );
}

export function Logo({ href = "/", tone = "ink", className }: { href?: string; tone?: "ink" | "paper"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md font-semibold tracking-tight",
        tone === "ink" ? "text-primary" : "text-rail-foreground",
        className,
      )}
    >
      <LogoMark className={tone === "paper" ? "text-[#f1eee7] [&_path:first-of-type]:fill-[#14283c]" : undefined} />
      <span className="text-[1.05rem]">
        Civic<span className={tone === "ink" ? "text-[#b8730f]" : "text-[#e3a640]"}>Fix</span>
      </span>
    </Link>
  );
}
