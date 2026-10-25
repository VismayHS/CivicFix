"use client";

import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteVectorPoint, getVectorPoint, reindexVectors, updateVectorPayload, vectorSearch } from "@/app/(portal)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { complaintRef } from "@/lib/format";
import type { VectorCollectionInfo, VectorHit, VectorPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

export function VectorConsole({ info, wards }: { info: VectorCollectionInfo; wards: { wardId: number; name: string }[] }) {
  const [pending, start] = useTransition();
  // search
  const [text, setText] = useState("big crater on the road near the junction");
  const [wardId, setWardId] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [hits, setHits] = useState<VectorHit[] | null>(null);
  // point inspector
  const [pointId, setPointId] = useState("");
  const [point, setPoint] = useState<VectorPoint | null | undefined>(undefined);
  const [key, setKey] = useState("priority_hint");
  const [value, setValue] = useState("high");

  const search = () =>
    start(async () => {
      const res = await vectorSearch(text, wardId ? Number(wardId) : null, openOnly);
      if (res.ok) setHits(res.data ?? []);
      else toast.error(res.error);
    });

  const load = (id: number) =>
    start(async () => {
      setPointId(String(id));
      const res = await getVectorPoint(id);
      if (res.ok) setPoint(res.data ?? null);
    });

  return (
    <div className="space-y-8">
      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Collection", info.name],
          ["Points", String(info.pointsCount)],
          ["Vector size", `${info.vectorSize}-d`],
          ["Distance", info.distance],
          ["Model", info.embeddingModel.split(" ")[0]],
          ["Status", info.status],
        ].map(([k, v]) => (
          <div key={k} className="border-r border-b px-4 py-3 last:border-r-0 lg:border-b-0">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={cn("mt-1 font-mono text-sm font-medium", k === "Status" && "text-ok")}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-5 text-xs text-muted-foreground">
        Payload indexes: {info.indexedPayloadFields.map((f) => `${f.field} (${f.type})`).join(", ")}.
        {info.source === "mock" && " Running on the mock source: scores come from a keyword-concept cosine until Qdrant is connected."}
      </p>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="font-semibold">Read · similarity search</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Embeds your text and returns nearest neighbours by cosine similarity, filtered by payload.</p>
        </div>
        <div className="space-y-4 p-5">
          <form
            className="flex flex-col gap-3 lg:flex-row lg:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="vtext">Query text</Label>
              <Input id="vtext" value={text} onChange={(e) => setText(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vward">Ward filter</Label>
              <select id="vward" value={wardId} onChange={(e) => setWardId(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm">
                <option value="">Any ward</option>
                {wards.map((w) => <option key={w.wardId} value={w.wardId}>{w.name}</option>)}
              </select>
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <Switch checked={openOnly} onCheckedChange={setOpenOnly} /> Open only
            </label>
            <Button type="submit" disabled={pending}>
              <Search data-icon="inline-start" /> Search
            </Button>
          </form>
          {hits && (
            hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No points matched.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/60 text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">Score</th>
                      <th scope="col" className="px-3 py-2 font-medium">Point</th>
                      <th scope="col" className="px-3 py-2 font-medium">Title (payload)</th>
                      <th scope="col" className="px-3 py-2 font-medium">ward_id · status</th>
                      <th scope="col" className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h) => (
                      <tr key={h.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${Math.round(h.score * 100)}%` }} /></span>
                            <span className="font-mono text-xs">{h.score.toFixed(3)}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{h.id}</td>
                        <td className="px-3 py-2">{String(h.payload.title ?? "")}</td>
                        <td className="px-3 py-2 font-mono text-xs">{String(h.payload.ward_id)} · {String(h.payload.status)}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="xs" variant="ghost" onClick={() => load(h.id)}>Inspect</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Read · retrieve a point</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Point IDs equal complaint IDs, so SQL and Qdrant line up one to one.</p>
          </div>
          <div className="space-y-4 p-5">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (Number(pointId) > 0) load(Number(pointId));
              }}
            >
              <Label htmlFor="pid" className="sr-only">Point ID</Label>
              <Input id="pid" value={pointId} onChange={(e) => setPointId(e.target.value.replace(/\D/g, ""))} placeholder="Point ID, e.g. 42" className="h-9 w-48 font-mono" inputMode="numeric" />
              <Button type="submit" variant="outline" disabled={pending}>Retrieve</Button>
            </form>
            {point === null && <p className="text-sm text-muted-foreground">No point with that ID (it may have been deleted).</p>}
            {point && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Point {point.id} · {complaintRef(point.id)}</p>
                <pre className="overflow-x-auto rounded-md bg-[#101b29] p-4 font-mono text-xs leading-relaxed text-[#e5e9f0]">{JSON.stringify(point.payload, null, 2)}</pre>
                <p className="font-mono text-xs break-all text-muted-foreground">vector[0..11] = [{point.vectorPreview.join(", ")}, …]</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">Update · set payload</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">The app does this on every status change, keeping is_open and status in sync.</p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pkey">Key</Label>
                <Input id="pkey" value={key} onChange={(e) => setKey(e.target.value)} className="h-9 font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pval">Value</Label>
                <Input id="pval" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 font-mono" />
              </div>
              <Button
                className="w-full"
                disabled={pending || !point}
                onClick={() =>
                  start(async () => {
                    const res = await updateVectorPayload(point!.id, key, value);
                    if (res.ok) {
                      setPoint(res.data);
                      toast.success(res.message);
                    } else toast.error(res.error);
                  })
                }
              >
                Update point {point?.id ?? ""}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-5">
            <h2 className="font-semibold">Delete</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Used when a citizen withdraws a complaint. Reindex rebuilds every point from SQL.</p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="destructive"
                className="flex-1"
                disabled={pending || !point}
                onClick={() =>
                  start(async () => {
                    const res = await deleteVectorPoint(point!.id);
                    if (res.ok) {
                      toast.success(res.message);
                      setPoint(null);
                    } else toast.error(res.error);
                  })
                }
              >
                <Trash2 data-icon="inline-start" /> Delete point
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await reindexVectors();
                    if (res.ok) toast.success(`Reindexed ${res.data?.indexed ?? 0} points from PostgreSQL`);
                  })
                }
              >
                <RefreshCw data-icon="inline-start" /> Reindex
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
