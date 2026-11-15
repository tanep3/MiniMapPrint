// Viewport computation and map projections.
// Ported from the pocket-map skill (make_map.py `bounds` / `xy`):
// flat-earth 111.32 km per degree with cos(lat) correction, and the two
// points must fit inside 75% of the side (12.5% margin on each side).

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export interface Viewport {
  south: number;
  west: number;
  north: number;
  east: number;
  /** Actual side length of the square viewport, in km. */
  actualKm: number;
  /** Set when the viewport had to grow beyond the chosen scale to fit
   *  both places: the snap step (or the exact size beyond 5 km). */
  expandedToKm: number | null;
}

export const SNAP_KM = [0.5, 1, 2, 3, 4, 5] as const;
export const MAX_KM = 20;

export function computeViewport(places: Place[], scaleKm: number): Viewport {
  if (places.length < 1 || places.length > 2) throw new Error("places");
  const centerLat = places.reduce((a, p) => a + p.lat, 0) / places.length;
  const centerLon = places.reduce((a, p) => a + p.lon, 0) / places.length;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  if (cosLat < 0.1) throw new Error("polar");

  const spanX =
    (Math.max(...places.map((p) => p.lon)) - Math.min(...places.map((p) => p.lon))) *
    111.32 *
    cosLat;
  const spanY =
    (Math.max(...places.map((p) => p.lat)) - Math.min(...places.map((p) => p.lat))) *
    111.32;
  const required = Math.max(spanX / 0.75, spanY / 0.75);

  let actual = scaleKm;
  let expandedToKm: number | null = null;
  if (places.length === 2 && required > scaleKm) {
    const step = SNAP_KM.find((s) => s >= required);
    actual = step ?? required;
    expandedToKm = actual;
  }
  if (actual > MAX_KM) throw new Error("too_far");

  const latHalf = actual / 2 / 111.32;
  const lonHalf = actual / 2 / (111.32 * cosLat);
  return {
    south: centerLat - latHalf,
    west: centerLon - lonHalf,
    north: centerLat + latHalf,
    east: centerLon + lonHalf,
    actualKm: actual,
    expandedToKm,
  };
}

/** Linear projection used by the line style (skill behaviour). */
export function projectLinear(
  lat: number,
  lon: number,
  vp: Viewport,
  w: number,
  h: number,
): [number, number] {
  return [
    ((lon - vp.west) / (vp.east - vp.west)) * w,
    ((vp.north - lat) / (vp.north - vp.south)) * h,
  ];
}

const merc = (latDeg: number): number =>
  Math.asinh(Math.tan((latDeg * Math.PI) / 180));

/** Web Mercator projection used by the raster (gray) style, so pins land
 *  on the same features as the tile basemap. */
export function projectMercator(
  lat: number,
  lon: number,
  vp: Viewport,
  w: number,
  h: number,
): [number, number] {
  return [
    ((lon - vp.west) / (vp.east - vp.west)) * w,
    ((merc(vp.north) - merc(lat)) / (merc(vp.north) - merc(vp.south))) * h,
  ];
}

/** Slippy-map world pixel coordinates at a zoom level (tile math). */
export function worldXY(lat: number, lon: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  return [
    ((lon + 180) / 360) * scale,
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale,
  ];
}
