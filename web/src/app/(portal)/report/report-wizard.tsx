"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Sparkles } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { checkDuplicates, fileComplaint, type FileComplaintState } from "@/app/(portal)/actions";
import { UpvoteButton } from "@/components/complaint/citizen-actions";
import { StatusBadge } from "@/components/complaint/status-badge";
import { SubmitButton } from "@/components/forms/submit-button";
import { LocationPickerMap } from "@/components/map";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { complaintRef, timeAgo } from "@/lib/format";
import type { Category, Department, DuplicateCandidate, Ward } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = ["Describe", "Locate", "Review"] as const;
const STEP_OF_FIELD: Record<string, number> = { wardId: 0, categoryId: 0, title: 0, description: 0, address: 1, latitude: 1, longitude: 1 };

export function ReportWizard({ wards, categories, departments }: { wards: Ward[]; categories: Category[]; departments: Department[] }) {
  const [state, action] = useActionState<FileComplaintState, FormData>(fileComplaint, {});
  const [step, setStep] = useState(0);
  const [wardId, setWardId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedText, setCheckedText] = useState("");

  const ward = wards.find((w) => String(w.wardId) === wardId);
  const category = categories.find((c) => String(c.categoryId) === categoryId);
  const department = departments.find((d) => d.departmentId === category?.departmentId);
  const text = `${title} ${description}`.trim();
  const errors = state.fieldErrors ?? {};

  // Server errors send the citizen back to the step that holds the field.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    const first = Object.keys(state.fieldErrors ?? {})[0];
    if (first) setStep(STEP_OF_FIELD[first] ?? 0);
  }

  // Live duplicate check (debounced). Stands in for Qdrant similarity search.
  useEffect(() => {
    if (!wardId || text.length < 25) return;
    const handle = setTimeout(async () => {
      setChecking(true);
      try {
        setCandidates(await checkDuplicates({ title, description, wardId: Number(wardId) }));
        setCheckedText(text);
      } finally {
        setChecking(false);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [wardId, title, description, text]);

  const grouped = useMemo(
    () => departments.map((d) => ({ d, items: categories.filter((c) => c.departmentId === d.departmentId) })).filter((g) => g.items.length),
    [categories, departments],
  );

  const step1Ready = !!wardId && !!categoryId && title.trim().length >= 8 && description.trim().length >= 20;
  const visibleCandidates = wardId && text.length >= 25 ? candidates : [];

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-[1fr_340px]">
      {/* Values travel with the form whichever step is visible */}
      <input type="hidden" name="wardId" value={wardId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="address" value={address} />
      <input type="hidden" name="latitude" value={pin?.[0] ?? ""} />
      <input type="hidden" name="longitude" value={pin?.[1] ?? ""} />

      <div className="min-w-0">
        <ol className="mb-8 flex items-center gap-3" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-3 last:flex-none">
              <span className={cn("flex items-center gap-2 text-sm", i === step ? "font-semibold text-foreground" : "text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
                <span className={cn("grid size-7 place-items-center rounded-full border text-xs font-medium", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "border-border")}>
                  {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
                </span>
                {s}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className={cn("h-px flex-1", i < step ? "bg-primary" : "bg-border")} />}
            </li>
          ))}
        </ol>

        {state.error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        {step === 0 && (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ward">Ward</Label>
                <Select value={wardId} onValueChange={setWardId}>
                  <SelectTrigger id="ward" className="h-10 w-full bg-card" aria-invalid={!!errors.wardId}>
                    <SelectValue placeholder="Where is the problem?" />
                  </SelectTrigger>
                  <SelectContent>
                    {wards.map((w) => (
                      <SelectItem key={w.wardId} value={String(w.wardId)}>
                        {w.name} <span className="text-muted-foreground">· ward {w.wardNumber}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.wardId && <p className="text-sm text-destructive">{errors.wardId}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="category" className="h-10 w-full bg-card" aria-invalid={!!errors.categoryId}>
                    <SelectValue placeholder="What kind of problem?" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {grouped.map((g) => (
                      <SelectGroup key={g.d.departmentId}>
                        <SelectLabel>{g.d.name}</SelectLabel>
                        {g.items.map((c) => (
                          <SelectItem key={c.categoryId} value={String(c.categoryId)}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                {errors.categoryId ? (
                  <p className="text-sm text-destructive">{errors.categoryId}</p>
                ) : (
                  category && (
                    <p className="text-xs text-muted-foreground">
                      Goes to {department?.name}. Deadline: <span className="font-mono text-foreground">{category.slaHours < 48 ? `${category.slaHours} h` : `${category.slaHours / 24} days`}</span>
                    </p>
                  )
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Short title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="e.g. Deep pothole near Sony World junction" className="h-10 bg-card" aria-invalid={!!errors.title} />
              {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="description">What&apos;s wrong?</Label>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{description.length}/2000</span>
              </div>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={6}
                placeholder="Describe what you see, how long it has been like this, and any risk to people. Landmarks help the field team find it."
                className="bg-card"
                aria-invalid={!!errors.description}
              />
              {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setStep(1)} disabled={!step1Ready}>
                Continue <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && ward && (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium">Drop a pin where the problem is</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Click the map. A pin helps the field team; you can skip it if you&apos;re not sure.</p>
            </div>
            <div className="overflow-hidden rounded-lg border bg-card p-1.5">
              <LocationPickerMap center={[ward.latitude, ward.longitude]} value={pin} onPick={(lat, lng) => setPin([lat, lng])} height={340} />
            </div>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4" aria-hidden />
              {pin ? <span className="font-mono">{pin[0].toFixed(5)}, {pin[1].toFixed(5)}</span> : "No pin yet"}
              {pin && (
                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setPin(null)}>
                  Remove
                </button>
              )}
            </p>
            <div className="space-y-2">
              <Label htmlFor="address">Address or landmark (optional)</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} placeholder="e.g. Opposite the bus stop on 80 Feet Road" className="h-10 bg-card" />
            </div>
            <div className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                <ArrowLeft data-icon="inline-start" /> Back
              </Button>
              <Button type="button" onClick={() => setStep(2)}>
                Review <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <dl className="divide-y rounded-lg border bg-card text-sm">
              {[
                ["Ward", ward?.name],
                ["Category", category?.name],
                ["Department", department?.name],
                ["Deadline", category ? `${category.slaHours} hours from filing` : ""],
                ["Title", title],
                ["Description", description],
                ["Location", pin ? `${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}${address ? ` · ${address}` : ""}` : address || "Not provided"],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="whitespace-pre-line">{v}</dd>
                </div>
              ))}
            </dl>
            {visibleCandidates.length > 0 && (
              <p className="rounded-md bg-signal-soft px-3 py-2 text-sm text-signal">
                {visibleCandidates.length} similar open {visibleCandidates.length === 1 ? "report exists" : "reports exist"}. Filing anyway is fine; staff will review and merge if it&apos;s the same problem.
              </p>
            )}
            <div className="flex justify-between">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft data-icon="inline-start" /> Back
              </Button>
              <SubmitButton size="lg" pendingText="Filing…">
                File complaint
              </SubmitButton>
            </div>
          </div>
        )}
      </div>

      <aside aria-live="polite" className="lg:sticky lg:top-8 lg:self-start">
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Similar open reports</h2>
            {checking && <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" aria-label="Checking" />}
          </div>
          <div className="p-4">
            {!wardId || text.length < 25 ? (
              <p className="text-sm text-muted-foreground">Choose a ward and describe the problem. We&apos;ll compare its meaning with open reports in that ward.</p>
            ) : visibleCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{checkedText ? `No similar open reports in ${ward?.name}. Yours will be the first.` : "Checking…"}</p>
            ) : (
              <ul className="space-y-4">
                {visibleCandidates.map((c) => (
                  <li key={c.complaintId} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{complaintRef(c.complaintId)}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <Link href={`/track/${c.complaintId}`} target="_blank" className="block text-sm font-medium hover:underline">
                      {c.title}
                    </Link>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(c.score * 100)}%` }} />
                      </span>
                      <span className="font-mono">{c.score.toFixed(2)} match</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Filed {timeAgo(c.createdAt)} · {c.upvoteCount} upvotes
                    </p>
                    <UpvoteButton complaintId={c.complaintId} upvoted={false} count={c.upvoteCount} className="h-8 w-full" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </form>
  );
}
