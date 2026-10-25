import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-10 font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-4xl font-medium">This page isn&apos;t on our map</h1>
      <p className="mt-3 max-w-md text-muted-foreground">The link may be old, or the page may have moved. If you were tracking a complaint, use its reference number.</p>
      <div className="mt-8 flex gap-2">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/track">Track a complaint</Link>
        </Button>
      </div>
    </main>
  );
}
