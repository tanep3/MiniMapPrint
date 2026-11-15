// Line-style rendering on Canvas 2D.
// Drawing rules ported from the pocket-map skill (make_map.py draw_map):
// road widths by highway class, thinning at wider scales, dashed paths,
// railways with a white dashed overlay. Widths are defined for a 384-dot
// output and scaled by s = outW / 384.

import type { Way } from "./overpass";
import { projectLinear, type Viewport } from "./viewport";

const ROAD_WIDTH: Record<string, number> = {
  motorway: 7, motorway_link: 5, trunk: 7, trunk_link: 5,
  primary: 6, primary_link: 4, secondary: 5, secondary_link: 4,
  tertiary: 4, tertiary_link: 3, unclassified: 3, residential: 3,
  service: 2, living_street: 2, track: 2,
};
const PATHS = new Set([
  "footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor",
]);
const RAILS = new Set(["rail", "subway", "light_rail", "tram", "narrow_gauge"]);

function roadWidth(hw: string | undefined, actualKm: number): number {
  const base = hw ? (ROAD_WIDTH[hw] ?? 0) : 0;
  if (!base) return 0;
  if (actualKm >= 3) {
    if (hw === "service" || hw === "living_street" || hw === "track") return 0;
    if (actualKm >= 4 && (hw === "residential" || hw === "unclassified")) return 0;
    return Math.max(1, Math.round(base * 0.45));
  }
  if (actualKm >= 2) return Math.max(1, Math.round(base * 0.65));
  return base;
}

export function renderLine(
  ways: Way[],
  vp: Viewport,
  w: number,
  h: number,
  s: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#000000";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const features = ways
    .map((way) => ({
      tags: way.tags,
      pts: way.geometry.map((p) => projectLinear(p.lat, p.lon, vp, w, h)),
    }))
    .filter((f) => f.pts.length >= 2);

  const stroke = (
    pts: Array<[number, number]>,
    widthDots: number,
    dash: number[] | null,
    color = "#000000",
  ) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(widthDots * s));
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Water and parks first (underlay).
  for (const f of features) {
    if (f.tags.waterway || f.tags.natural === "water") {
      stroke(f.pts, vp.actualKm <= 2 ? 2 : 1, null);
    } else if (f.tags.leisure === "park") {
      stroke(f.pts, 1, null);
    }
  }
  // Thin roads, then paths dashed.
  const threshold = vp.actualKm >= 3 ? 1 : 3;
  for (const f of features) {
    const width = roadWidth(f.tags.highway, vp.actualKm);
    if (width && width <= threshold) {
      stroke(f.pts, width, null);
    } else if (
      f.tags.highway &&
      PATHS.has(f.tags.highway) &&
      vp.actualKm < 3
    ) {
      stroke(f.pts, 1, [7 * s, 5 * s]);
    }
  }
  // Thick roads on top.
  for (const f of features) {
    const width = roadWidth(f.tags.highway, vp.actualKm);
    if (width && width > threshold) stroke(f.pts, width, null);
  }
  // Railways last, with the white dashed overlay at close scales.
  for (const f of features) {
    if (f.tags.railway && RAILS.has(f.tags.railway)) {
      const railWidth = vp.actualKm < 3 ? 4 : 2;
      stroke(f.pts, railWidth, null);
      if (railWidth === 4) stroke(f.pts, 2, [5 * s, 6 * s], "#ffffff");
    }
  }
  return canvas;
}
