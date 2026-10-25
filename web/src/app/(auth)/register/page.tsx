import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="font-display text-3xl font-medium">Create a citizen account</h1>
      <p className="mt-2 mb-8 text-sm text-muted-foreground">You need an account to report issues, upvote existing ones and get updates. Staff accounts are created by ward administrators.</p>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <RegisterForm />
      </Suspense>
    </>
  );
}
