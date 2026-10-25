import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t bg-[#efebe2]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-sm text-muted-foreground">
            A grievance redressal system for Bengaluru wards, with semantic duplicate detection and SLA-based escalation. Built for DBMS UE24CS351A at PES University.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Citizens</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link className="hover:text-foreground" href="/report">Report an issue</Link></li>
            <li><Link className="hover:text-foreground" href="/track">Track a complaint</Link></li>
            <li><Link className="hover:text-foreground" href="/search">Search existing reports</Link></li>
            <li><Link className="hover:text-foreground" href="/dashboard">City dashboard</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Project</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>Vismay HS · PES1UG24AM325</li>
            <li>Ashvin Ronald Lobo · PES1UG24AM345</li>
            <li><a className="hover:text-foreground" href="https://github.com/VismayHS/CivicFix">Source on GitHub</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
