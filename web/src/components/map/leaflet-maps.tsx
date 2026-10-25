"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/constants";
import { complaintRef } from "@/lib/format";
import type { MapPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Plain Leaflet driven from effects. Each mount creates its own map and the
 * cleanup always calls map.remove(), so React's dev double-mount and Next's
 * page caching (hide/show) can never reuse a stale map container.
 */

const BENGALURU: L.LatLngTuple = [12.9616, 77.6216];

const TONE_COLOR = {
  neutral: "#586170",
  info: "#24578a",
  signal: "#b8730f",
  danger: "#a8231c",
  ok: "#24693f",
  dup: "#5f4596",
} as const;

const TILES = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// Titles are typed by citizens: escape before putting them in popup HTML.
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function popupHtml(p: MapPoint, linkBase: string) {
  return `<div style="font-family:var(--font-public-sans),system-ui,sans-serif;min-width:180px">
    <p style="margin:0;font:11px var(--font-plex-mono),monospace;color:#586170">${complaintRef(p.complaintId)} · ${STATUS_LABEL[p.status]}</p>
    <p style="margin:4px 0 0;font-size:13px;font-weight:600;color:#17202c">${escapeHtml(p.title)}</p>
    <p style="margin:2px 0 0;font-size:12px;color:#586170">${escapeHtml(p.categoryName)}</p>
    <a href="${linkBase}/${p.complaintId}" style="display:inline-block;margin-top:6px;font-size:12px;font-weight:500;color:#24578a">View timeline</a>
  </div>`;
}

function addTiles(map: L.Map) {
  L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: 19 }).addTo(map);
}

export default function ComplaintsMap({ points, height = 420, linkBase = "/track" }: { points: MapPoint[]; height?: number; linkBase?: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { center: BENGALURU, zoom: 12, scrollWheelZoom: false });
    addTiles(map);
    for (const p of points) {
      L.circleMarker([p.latitude, p.longitude], {
        radius: 6,
        color: "#ffffff",
        weight: 1.5,
        fillColor: TONE_COLOR[STATUS_TONE[p.status]],
        fillOpacity: 0.9,
      })
        .bindPopup(popupHtml(p, linkBase))
        .addTo(map);
    }
    return () => {
      map.remove();
    };
  }, [points, linkBase]);

  return <div ref={el} style={{ height }} className="z-0 w-full rounded-lg" role="region" aria-label="Map of reported complaints" />;
}

export function LocationPickerMap({
  center,
  value,
  onPick,
  height = 300,
}: {
  center: [number, number];
  value: [number, number] | null;
  onPick: (lat: number, lng: number) => void;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  // Latest callback/value without re-creating the map on every render
  const onPickRef = useRef(onPick);
  const valueRef = useRef(value);
  useEffect(() => {
    onPickRef.current = onPick;
    valueRef.current = value;
  });

  const [lat, lng] = center;
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { center: valueRef.current ?? [lat, lng], zoom: 15, scrollWheelZoom: false });
    addTiles(map);
    map.on("click", (e: L.LeafletMouseEvent) => onPickRef.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
    mapRef.current = map;
    if (valueRef.current) markerRef.current = pinAt(valueRef.current).addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [lat, lng]);

  // Keep the pin in sync with the selected value
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
    } else if (markerRef.current) {
      markerRef.current.setLatLng(value);
    } else {
      markerRef.current = pinAt(value).addTo(map);
    }
  }, [value]);

  return <div ref={el} style={{ height }} className={cn("z-0 w-full cursor-crosshair rounded-lg")} role="application" aria-label="Map: click to place a pin" />;
}

function pinAt(at: [number, number]) {
  return L.circleMarker(at, { radius: 9, color: "#ffffff", weight: 2, fillColor: "#17324d", fillOpacity: 1 });
}
