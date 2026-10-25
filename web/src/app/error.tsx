"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-3xl font-medium">Something went wrong</h1>
      <p className="mt-3 max-w-md text-muted-foreground">{error.message || "An unexpected error occurred while loading this page."}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
