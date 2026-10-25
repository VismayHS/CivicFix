import { Logo } from "@/components/brand/logo";
import { SlaBar } from "@/components/complaint/sla-bar";
import { StatusBadge } from "@/components/complaint/status-badge";

const H = 3_600_000;

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail p-10 text-rail-foreground lg:flex">
        <Logo tone="paper" />
        <div className="max-w-md space-y-8">
          <blockquote className="font-display text-[2.1rem] leading-[1.15]">
            &ldquo;Reported the streetlight on a Monday. It was escalated by Wednesday and fixed on Thursday.&rdquo;
          </blockquote>
          <ExampleTicket />
        </div>
        <p className="text-xs text-rail-muted">DBMS UE24CS351A · PES University · Vismay HS &amp; Ashvin Ronald Lobo</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** A static illustration of a complaint card, drawn with real components. */
function ExampleTicket() {
  // Fixed timestamps so the illustration renders the same on every request.
  const created = Date.UTC(2026, 9, 19, 9, 30);
  const complaint = {
    createdAt: new Date(created).toISOString(),
    slaDeadline: new Date(created + 48 * H).toISOString(),
    resolvedAt: new Date(created + 70 * H).toISOString(),
    status: "RESOLVED" as const,
  };
  return (
    <div className="rounded-lg bg-[#f6f4ef] p-4 text-foreground shadow-[0_18px_40px_-20px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-muted-foreground">CF-00087 · Indiranagar</span>
        <StatusBadge status="RESOLVED" />
      </div>
      <p className="mt-2 font-medium">Streetlights not working on 12th Main</p>
      <SlaBar complaint={complaint} className="mt-3" now={created + 72 * H} />
    </div>
  );
}
