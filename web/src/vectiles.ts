// Line-style data from vector tiles (Versatiles, Shortbread schema) —
// the primary source since v0.2.0. Tiles are pre-rendered extracts of
// OSM served from a CDN, so extraction happens locally in the browser
// instead of waiting on an Overpass query (measured 2026-11-15: a
// Shinjuku z14 tile, 554 KB, arrives in ~1 s, while Overpass needed
// ~30 s even for a 408-element query). Shortbread `kind` values map
// almost 1:1 onto the OSM tags the line renderer classifies by, so
// features are re-tagged into the same Way shape Overpass returns.
// Data: © OpenStreetMap contributors (ODbL), tiles by Versatiles.

import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import type { Way } from "./overpass";
import type { Viewport } from "./viewport";

const TILE_URL = (z: number, x: number, y: number) =>
  `https://tiles.versatiles.org/tiles/osm/${z}/${x}/${y}.pbf`;
const MAX_ZOOM = 14; // Versatiles maxzoom
const MAX_TILES = 16; // same discipline as the raster tile planner
const TILE_TIMEOUT_MS = 20_000;

const RAIL_KINDS = new Set([
  "rail", "subway", "light_rail", "tram", "narrow_gauge", "monorail", "funicular",
]);

interface TilePlan {
  z: number;
  xs: number[];
  ys: number[];
}

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

function planTiles(vp: Viewport): TilePlan {
  let z = MAX_ZOOM;
  for (;;) {
    const x0 = lonToTileX(vp.west, z);
    const x1 = lonToTileX(vp.east, z);
    const y0 = latToTileY(vp.north, z);
    const y1 = latToTileY(vp.south, z);
    const xs = Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i);
    const ys = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
    if (xs.length * ys.length <= MAX_TILES || z <= 10) return { z, xs, ys };
    z -= 1;
  }
}

type LonLat = { lat: number; lon: number };

function lineWays(
  coords: number[][],
  tags: Record<string, string>,
  out: Way[],
): void {
  if (coords.length < 2) return;
  out.push({
    tags,
    geometry: coords.map(([lon, lat]) => ({ lat, lon }) as LonLat),
  });
}

function extractLayer(
  tile: VectorTile,
  layerName: string,
  tagsFor: (props: Record<string, unknown>) => Record<string, string> | null,
  plan: TilePlan,
  tileX: number,
  tileY: number,
  out: Way[],
): void {
  const layer = tile.layers[layerName];
  if (!layer) return;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const tags = tagsFor(feature.properties as Record<string, unknown>);
    if (!tags) continue;
    const geo = feature.toGeoJSON(tileX, tileY, plan.z).geometry;
    if (geo.type === "LineString") {
      lineWays(geo.coordinates as number[][], tags, out);
    } else if (geo.type === "MultiLineString" || geo.type === "Polygon") {
      for (const part of geo.coordinates as number[][][]) {
        lineWays(part, tags, out);
      }
    } else if (geo.type === "MultiPolygon") {
      for (const poly of geo.coordinates as number[][][][]) {
        for (const ring of poly) lineWays(ring, tags, out);
      }
    }
  }
}

export async function fetchWaysFromTiles(vp: Viewport): Promise<Way[]> {
  const plan = planTiles(vp);
  const jobs: Array<Promise<Way[]>> = [];
  for (const x of plan.xs) {
    for (const y of plan.ys) {
      jobs.push(
        (async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), TILE_TIMEOUT_MS);
          try {
            const res = await fetch(TILE_URL(plan.z, x, y), {
              signal: ctrl.signal,
            });
            if (res.status === 404) return []; // empty tile (e.g. open water)
            if (!res.ok) throw new Error(`vector tile HTTP ${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            const tile = new VectorTile(new Pbf(buf));
            const ways: Way[] = [];
            extractLayer(
              tile,
              "streets",
              (p): Record<string, string> | null => {
                const kind = String(p.kind ?? "");
                if (!kind) return null;
                if (RAIL_KINDS.has(kind)) return { railway: "rail" };
                return { highway: p.link === true ? `${kind}_link` : kind };
              },
              plan, x, y, ways,
            );
            extractLayer(
              tile,
              "water_lines",
              (p) => ({ waterway: String(p.kind ?? "waterway") }),
              plan, x, y, ways,
            );
            extractLayer(
              tile,
              "water_polygons",
              () => ({ natural: "water" }),
              plan, x, y, ways,
            );
            extractLayer(
              tile,
              "land",
              (p) => (p.kind === "park" ? { leisure: "park" } : null),
              plan, x, y, ways,
            );
            extractLayer(
              tile,
              "street_polygons",
              () => ({ highway: "pedestrian" }),
              plan, x, y, ways,
            );
            return ways;
          } finally {
            clearTimeout(timer);
          }
        })(),
      );
    }
  }
  const perTile = await Promise.all(jobs);
  const ways = perTile.flat();
  if (ways.length === 0) {
    throw new Error("vector tiles returned no features");
  }
  return ways;
}
