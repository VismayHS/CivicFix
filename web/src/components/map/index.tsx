"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Leaflet touches `window`, so maps only render in the browser.
export const ComplaintsMap = dynamic(() => import("./leaflet-maps"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-lg" />,
});

export const LocationPickerMap = dynamic(() => import("./leaflet-maps").then((m) => m.LocationPickerMap), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full rounded-lg" />,
});
