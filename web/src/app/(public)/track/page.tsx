import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseComplaintRef } from "@/lib/format";

export const metadata: Metadata = { title: "Track a complaint" };

async function lookup(formData: FormData) {
  "use server";
  const id = parseComplaintRef(String(formData.get("ref") ?? ""));
  // An unparseable reference lands on the "not found" page with guidance.
  redirect(`/track/${id ?? 0}`);
}

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:px-6 md:py-20">
      <PageHeader title="Track a complaint" description="Enter the reference number from your confirmation, like CF-00042. Anyone can see a complaint's status and timeline; personal details stay private." />
      <form action={lookup} className="mt-8 space-y-3">
        <Label htmlFor="ref">Reference number</Label>
        <div className="flex gap-2">
          <Input id="ref" name="ref" required placeholder="CF-00042" autoComplete="off" spellCheck={false} className="h-11 bg-card font-mono text-base uppercase" />
          <Button type="submit" size="lg">Track</Button>
        </div>
        <p className="text-sm text-muted-foreground">You can also type just the number, such as 42.</p>
      </form>
    </div>
  );
}
