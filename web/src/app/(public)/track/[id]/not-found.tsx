import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";

export default function ComplaintNotFound() {
  return (
    <EmptyState
      icon={FileQuestion}
      title="We couldn't find that complaint"
      className="mt-6"
      action={
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/track">Try another reference</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/search">Search reports</Link>
          </Button>
        </div>
      }
    >
      Check the reference on your confirmation. It looks like CF-00042.
    </EmptyState>
  );
}
