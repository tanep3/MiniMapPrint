// OSM standard-tile mosaic for the gray style.
// Zoom rule ported from the pocket-map skill (raster_map.py): pick the
// native zoom nearest to the output size so resampling stays minimal.
// Tile policy: only the current viewport is fetched, at most 16 tiles;
// if the viewport would need more, the zoom is lowered until it fits
// (design decision for the web version).

import { worldXY, type Viewport } from "./viewport";

export interface TilePlan {
  zoom: number;
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
  count: number;
}

const TILE = 256;
const MAX_TILES = 16;

export function planTiles(vp: Viewport, outW: number, outH: number): TilePlan {
  const [x0z, y1z] = worldXY(vp.south, vp.west, 0);
  const [x1z, y0z] = worldXY(vp.north, vp.east, 0);
  let zoom = Math.max(
    0,
    Math.min(
      19,
      Math.round(
        Math.log2(Math.max((outW - 1) / (x1z - x0z), (outH - 1) / (y1z - y0z))),
      ),
    ),
  );
  for (;;) {
    const [x0, y0] = worldXY(vp.north, vp.west, zoom);
    const [x1, y1] = worldXY(vp.south, vp.east, zoom);
    const tx0 = Math.floor(x0 / TILE);
    const ty0 = Math.floor(y0 / TILE);
    const tx1 = Math.ceil(x1 / TILE) - 1;
    const ty1 = Math.ceil(y1 / TILE) - 1;
    const count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    if ((count >= 1 && count <= MAX_TILES) || zoom === 0) {
      return { zoom, tx0, ty0, tx1, ty1, count };
    }
    zoom -= 1;
  }
}

function loadTileImage(z: number, x: number, y: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile ${z}/${x}/${y}`));
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  });
}

/** Fetch the mosaic and resample the exact viewport extent onto a canvas
 *  of outW x outH. Failed tiles are left white and counted. */
export async function fetchMosaic(
  vp: Viewport,
  outW: number,
  outH: number,
): Promise<{ canvas: HTMLCanvasElement; plan: TilePlan; failed: number }> {
  const plan = planTiles(vp, outW, outH);
  const cols = plan.tx1 - plan.tx0 + 1;
  const rows = plan.ty1 - plan.ty0 + 1;
  const mosaic = document.createElement("canvas");
  mosaic.width = cols * TILE;
  mosaic.height = rows * TILE;
  const mctx = mosaic.getContext("2d")!;
  mctx.fillStyle = "#ffffff";
  mctx.fillRect(0, 0, mosaic.width, mosaic.height);

  let failed = 0;
  const jobs: Array<Promise<void>> = [];
  for (let ty = plan.ty0; ty <= plan.ty1; ty++) {
    for (let tx = plan.tx0; tx <= plan.tx1; tx++) {
      jobs.push(
        loadTileImage(plan.zoom, tx, ty)
          .then((img) =>
            mctx.drawImage(img, (tx - plan.tx0) * TILE, (ty - plan.ty0) * TILE),
          )
          .catch(() => {
            failed += 1;
          }),
      );
    }
  }
  await Promise.all(jobs);
  if (failed === plan.count) throw new Error("all tiles failed");

  // Extent resample with pixel-center alignment, as in raster_map.py.
  const [x0, y0] = worldXY(vp.north, vp.west, plan.zoom);
  const [x1, y1] = worldXY(vp.south, vp.east, plan.zoom);
  const dx = (x1 - x0) / (outW - 1);
  const dy = (y1 - y0) / (outH - 1);
  const sx = x0 - plan.tx0 * TILE - dx / 2;
  const sy = y0 - plan.ty0 * TILE - dy / 2;
  const sw = x1 - x0 + dx;
  const sh = y1 - y0 + dy;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mosaic, sx, sy, sw, sh, 0, 0, outW, outH);
  return { canvas, plan, failed };
}
