// Vector data (roads, railways, water, parks) via Overpass API.
// The query is ported from the pocket-map skill; the endpoint order is
// not (see ENDPOINTS below).

import type { Viewport } from "./viewport";

export interface Way {
  tags: Record<string, string>;
  geometry: Array<{ lat: number; lon: number }>;
}

// Order measured 2026-11-15 with the Shinjuku 2 km query (~3.9 MB):
// overpass-api.de answered in ~29 s; overpass.private.coffee (the
// pocket-map skill's first choice) did not answer at all within 180 s,
// which cost the app its 45 s timeout before the fallback even started.
// The main instance goes first; private.coffee stays as fallback.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export class RateLimitedError extends Error {}

export async function fetchWays(vp: Viewport): Promise<Way[]> {
  const bb = `${vp.south.toFixed(6)},${vp.west.toFixed(6)},${vp.north.toFixed(6)},${vp.east.toFixed(6)}`;
  const query =
    `[out:json][timeout:120];(way["highway"](${bb});way["railway"](${bb});` +
    `way["waterway"](${bb});way["natural"="water"](${bb});` +
    `way["leisure"="park"](${bb}););out geom;`;

  // Patience matters more than failover speed here: measured 2026-11-15,
  // overpass-api.de needed ~30 s even for a 1 km / 408-element query
  // (server-side queueing), and the previous 45 s cap could abort a
  // request that was about to succeed. The card shows elapsed seconds
  // while waiting.
  const errors: string[] = [];
  for (const endpoint of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 130_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        signal: ctrl.signal,
      });
      if (res.status === 406 || res.status === 429) {
        throw new RateLimitedError(`overpass ${res.status}`);
      }
      if (!res.ok) {
        errors.push(`${endpoint}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        elements?: Array<{
          type: string;
          tags?: Record<string, string>;
          geometry?: Array<{ lat: number; lon: number }>;
        }>;
      };
      const ways: Way[] = (data.elements ?? [])
        .filter((e) => e.type === "way" && e.geometry && e.geometry.length >= 2)
        .map((e) => ({ tags: e.tags ?? {}, geometry: e.geometry! }));
      return ways;
    } catch (e) {
      if (e instanceof RateLimitedError) throw e;
      errors.push(`${endpoint}: ${String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`overpass failed: ${errors.join("; ")}`);
}
