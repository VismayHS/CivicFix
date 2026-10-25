import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/session";
import { ROLE_HOME } from "@/lib/constants";
import { PublicMobileMenu } from "./public-mobile-menu";

export const PUBLIC_LINKS = [
  { href: "/dashboard", label: "City dashboard" },
  { href: "/search", label: "Search reports" },
  { href: "/track", label: "Track a complaint" },
];

async function AuthActions() {
  const user = await getSessionUser();
  if (user) {
    return (
      <Button asChild size="sm">
        <Link href={ROLE_HOME[user.role]}>{user.role === "CITIZEN" ? "My complaints" : "Open portal"}</Link>
      </Button>
    );
  }
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
        <Link href="/login">Sign in</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/report">Report an issue</Link>
      </Button>
    </>
  );
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {PUBLIC_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm text-foreground/75 transition-colors hover:bg-accent hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={<div className="h-8 w-36" />}>
            <AuthActions />
          </Suspense>
          <PublicMobileMenu links={PUBLIC_LINKS} />
        </div>
      </div>
    </header>
  );
}
