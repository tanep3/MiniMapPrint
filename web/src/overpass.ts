// Vector data (roads, railways, water, parks) via Overpass API.
// The query is ported from the pocket-map skill; the endpoint order is
// not (see ENDPOINTS below).

import type { Viewport } from "./viewport";

export interface Way {
  tags: Record<string, string>;
  geometry: Array<{ lat: number; lon: number }>;
}

// The endpoints are RACED (see fetchWays): measured 2026-11-15, the
// Shinjuku 2 km query took ~29 s on overpass-api.de while
// overpass.private.coffee did not answer at all within 180 s. With a
// sequential fallback, a hung endpoint costs the full timeout before
// the healthy one is even asked; racing makes the total wait the
// fastest endpoint's time. The loser is aborted immediately, which
// also stops its server-side work in the usual case.
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

  // Race all endpoints in parallel; the first full response wins and
  // the losers are aborted. A rate-limit response (406/429) does not
  // win: the other endpoint may still answer. Patience per endpoint
  // stays generous (measured 2026-11-15: overpass-api.de needed ~30 s
  // even for a 1 km / 408-element query due to server-side queueing),
  // and the card shows elapsed seconds while waiting.
  return new Promise<Way[]>((resolve, reject) => {
    let settled = false;
    let failures = 0;
    let rateLimited = false;
    const errors: string[] = [];
    const controllers = ENDPOINTS.map(() => new AbortController());
    const timers = controllers.map((c) =>
      setTimeout(() => c.abort(), 130_000),
    );
    const cleanup = () => timers.forEach((tm) => clearTimeout(tm));

    ENDPOINTS.forEach((endpoint, i) => {
      (async () => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ data: query }),
            signal: controllers[i].signal,
          });
          if (res.status === 406 || res.status === 429) {
            rateLimited = true;
            throw new Error(`rate limited (${res.status})`);
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            elements?: Array<{
              type: string;
              tags?: Record<string, string>;
              geometry?: Array<{ lat: number; lon: number }>;
            }>;
          };
          const ways: Way[] = (data.elements ?? [])
            .filter(
              (e) => e.type === "way" && e.geometry && e.geometry.length >= 2,
            )
            .map((e) => ({ tags: e.tags ?? {}, geometry: e.geometry! }));
          if (settled) return;
          settled = true;
          cleanup();
          controllers.forEach((c, j) => {
            if (j !== i) c.abort();
          });
          resolve(ways);
        } catch (e) {
          if (settled) return; // loser aborted after the winner finished
          errors.push(`${endpoint}: ${String(e)}`);
          failures += 1;
          if (failures === ENDPOINTS.length) {
            cleanup();
            if (rateLimited) {
              reject(new RateLimitedError(errors.join("; ")));
            } else {
              reject(new Error(`overpass failed: ${errors.join("; ")}`));
            }
          }
        }
      })();
    });
  });
}
