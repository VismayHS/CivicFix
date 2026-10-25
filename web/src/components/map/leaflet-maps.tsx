"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from "react-leaflet";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/constants";
import { complaintRef } from "@/lib/format";
import type { MapPoint } from "@/lib/types";

const BENGALURU: [number, number] = [12.9616, 77.6216];

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

export default function ComplaintsMap({ points, height = 420, linkBase = "/track" }: { points: MapPoint[]; height?: number; linkBase?: string }) {
  return (
    <MapContainer center={BENGALURU} zoom={12} scrollWheelZoom={false} style={{ height }} className="z-0 w-full rounded-lg">
      <TileLayer url={TILES.url} attribution={TILES.attribution} />
      {points.map((p) => {
        const color = TONE_COLOR[STATUS_TONE[p.status]];
        return (
          <CircleMarker key={p.complaintId} center={[p.latitude, p.longitude]} radius={6} pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: color, fillOpacity: 0.9 }}>
            <Popup>
              <div className="space-y-1 font-sans">
                <p className="font-mono text-[11px] text-[#586170]">{complaintRef(p.complaintId)} · {STATUS_LABEL[p.status]}</p>
                <p className="text-sm font-semibold text-[#17202c]">{p.title}</p>
                <p className="text-xs text-[#586170]">{p.categoryName}</p>
                <Link href={`${linkBase}/${p.complaintId}`} className="text-xs font-medium text-[#24578a]">
                  View timeline
                </Link>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)) });
  return null;
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
  return (
    <MapContainer key={center.join(",")} center={value ?? center} zoom={15} scrollWheelZoom={false} style={{ height }} className="z-0 w-full cursor-crosshair rounded-lg">
      <TileLayer url={TILES.url} attribution={TILES.attribution} />
      <ClickToPlace onPick={onPick} />
      {value && <CircleMarker center={value} radius={9} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#17324d", fillOpacity: 1 }} />}
    </MapContainer>
  );
}
