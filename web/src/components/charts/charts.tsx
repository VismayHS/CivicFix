"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { DailyPoint, DepartmentStat } from "@/lib/types";

const shortDept = (name: string) => name.replace(" & Infrastructure", "").replace(" Management", "").replace(" & Sewerage", "").replace(" & Urban Forestry", "");

const slaConfig = { slaMetPct: { label: "Resolved within SLA", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Horizontal bars; below 70% turns amber so laggards stand out. */
export function SlaByDepartmentChart({ rows }: { rows: DepartmentStat[] }) {
  const data = rows
    .filter((r) => r.slaMetPct !== null)
    .map((r) => ({ name: shortDept(r.departmentName), slaMetPct: Math.round(r.slaMetPct!) }))
    .sort((a, b) => b.slaMetPct - a.slaMetPct);
  return (
    <ChartContainer config={slaConfig} className="aspect-auto h-[280px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent formatter={(v) => `${v}% within SLA`} hideIndicator />} />
        <Bar dataKey="slaMetPct" radius={3} barSize={18}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.slaMetPct < 70 ? "var(--chart-2)" : "var(--chart-1)"} />
          ))}
          <LabelList dataKey="slaMetPct" position="right" formatter={(v) => `${v}%`} className="fill-foreground font-mono text-xs" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const dailyConfig = {
  filed: { label: "Filed", color: "var(--chart-1)" },
  resolved: { label: "Resolved", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function FiledResolvedChart({ rows }: { rows: DailyPoint[] }) {
  const data = rows.map((r) => ({ ...r, label: new Date(r.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) }));
  return (
    <ChartContainer config={dailyConfig} className="aspect-auto h-[280px] w-full">
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillFiled" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-filed)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--color-filed)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Area dataKey="filed" type="monotone" stroke="var(--color-filed)" strokeWidth={2} fill="url(#fillFiled)" />
        <Area dataKey="resolved" type="monotone" stroke="var(--color-resolved)" strokeWidth={2} fill="transparent" />
      </AreaChart>
    </ChartContainer>
  );
}

const openConfig = {
  open: { label: "Open", color: "var(--chart-1)" },
  breached: { label: "Past deadline", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function OpenByDepartmentChart({ rows }: { rows: DepartmentStat[] }) {
  const data = rows.map((r) => ({ name: shortDept(r.departmentName), open: r.open - r.breached, breached: r.breached }));
  return (
    <ChartContainer config={openConfig} className="aspect-auto h-[260px] w-full">
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="open" stackId="a" fill="var(--color-open)" barSize={28} />
        <Bar dataKey="breached" stackId="a" fill="var(--color-breached)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
