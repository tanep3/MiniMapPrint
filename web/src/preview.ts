// Interactive original-map preview (v0.4.0): the OSM raster mosaic is
// fetched for a buffered area (2x the framing side) and the visible
// window is redrawn from that buffer on every gesture frame — one
// drawImage, so dragging and pinching stay smooth. Gestures only move
// the window; on settle the framing (centre + snapped scale) is
// committed and the buffer is refetched when the window has wandered
// too close to the buffer edge or the scale changed.

import { fetchMosaic } from "./tiles";
import {
  SNAP_KM,
  viewportAround,
  worldXY,
  type Place,
} from "./viewport";

export interface Framing {
  lat: number;
  lon: number;
  scaleKm: number;
}

const BUFFER_FACTOR = 2;
const BUFFER_PX = 1024;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

interface BufferState {
  canvas: HTMLCanvasElement;
  zoom: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Preview {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private loadingEl: HTMLElement;
  private onCommit: (f: Framing) => void;
  private onError: () => void;

  private framing: Framing | null = null;
  private places: Place[] = [];
  private buffer: BufferState | null = null;
  private winCx = 0;
  private winCy = 0;
  private dispZoom = 1;
  private generation = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private settleTimer: number | undefined;

  constructor(
    canvas: HTMLCanvasElement,
    loadingEl: HTMLElement,
    onCommit: (f: Framing) => void,
    onError: () => void,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.loadingEl = loadingEl;
    this.onCommit = onCommit;
    this.onError = onError;
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.pointerUp(e));
    canvas.addEventListener("pointercancel", (e) => this.pointerUp(e));
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.dispZoom = clamp(
          this.dispZoom * Math.exp(-e.deltaY * 0.0016),
          ZOOM_MIN,
          ZOOM_MAX,
        );
        this.draw();
        this.scheduleSettle();
      },
      { passive: false },
    );
    canvas.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "+" || e.key === "=") this.dispZoom = clamp(this.dispZoom * 1.25, ZOOM_MIN, ZOOM_MAX);
      else if (e.key === "-" || e.key === "_") this.dispZoom = clamp(this.dispZoom / 1.25, ZOOM_MIN, ZOOM_MAX);
      else if (e.key === "0") this.dispZoom = 1;
      else return;
      e.preventDefault();
      this.draw();
      this.scheduleSettle();
    });
  }

  getFraming(): Framing | null {
    return this.framing;
  }

  /** Show the preview at a fitted framing and fetch its buffer. */
  async show(framing: Framing, places: Place[]): Promise<void> {
    this.framing = framing;
    this.places = places;
    this.dispZoom = 1;
    await this.refetch();
  }

  /** Keep the centre, change the scale (slider sync). */
  async setScale(scaleKm: number): Promise<void> {
    if (!this.framing || this.framing.scaleKm === scaleKm) return;
    this.framing = { ...this.framing, scaleKm };
    this.dispZoom = 1;
    await this.refetch();
  }

  private async refetch(): Promise<void> {
    if (!this.framing) return;
    const gen = ++this.generation;
    this.loadingEl.hidden = false;
    try {
      const vp = viewportAround(
        this.framing.lat,
        this.framing.lon,
        this.framing.scaleKm * BUFFER_FACTOR,
      );
      const { canvas, plan } = await fetchMosaic(vp, BUFFER_PX, BUFFER_PX);
      if (gen !== this.generation) return;
      const [x0, y0] = worldXY(vp.north, vp.west, plan.zoom);
      const [x1, y1] = worldXY(vp.south, vp.east, plan.zoom);
      this.buffer = { canvas, zoom: plan.zoom, x0, y0, x1, y1 };
      const [cx, cy] = this.latLonToBuffer(this.framing.lat, this.framing.lon);
      this.winCx = cx;
      this.winCy = cy;
      this.draw();
    } catch {
      if (gen === this.generation) this.onError();
    } finally {
      if (gen === this.generation) this.loadingEl.hidden = true;
    }
  }

  private latLonToBuffer(lat: number, lon: number): [number, number] {
    const b = this.buffer!;
    const [wx, wy] = worldXY(lat, lon, b.zoom);
    return [
      ((wx - b.x0) / (b.x1 - b.x0)) * BUFFER_PX,
      ((wy - b.y0) / (b.y1 - b.y0)) * BUFFER_PX,
    ];
  }

  private bufferToLatLon(px: number, py: number): { lat: number; lon: number } {
    const b = this.buffer!;
    const wx = b.x0 + (px / BUFFER_PX) * (b.x1 - b.x0);
    const wy = b.y0 + (py / BUFFER_PX) * (b.y1 - b.y0);
    const world = 256 * 2 ** b.zoom;
    const lon = (wx / world) * 360 - 180;
    const lat =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / world))) * 180) / Math.PI;
    return { lat, lon };
  }

  private winSize(): number {
    return BUFFER_PX / BUFFER_FACTOR / this.dispZoom;
  }

  private clampWindow(): void {
    const half = this.winSize() / 2;
    if (this.winSize() >= BUFFER_PX) {
      this.winCx = BUFFER_PX / 2;
      this.winCy = BUFFER_PX / 2;
      return;
    }
    this.winCx = clamp(this.winCx, half, BUFFER_PX - half);
    this.winCy = clamp(this.winCy, half, BUFFER_PX - half);
  }

  private draw(): void {
    if (!this.buffer || !this.framing) return;
    this.clampWindow();
    const size = this.winSize();
    const sx = this.winCx - size / 2;
    const sy = this.winCy - size / 2;
    const W = this.canvas.width;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.fillStyle = "#e8e4da";
    this.ctx.fillRect(0, 0, W, W);
    this.ctx.drawImage(this.buffer.canvas, sx, sy, size, size, 0, 0, W, W);
    // Resolved places as small markers (the big centre pin is the
    // HTML overlay marking the framing centre itself).
    for (const p of this.places) {
      const [bx, by] = this.latLonToBuffer(p.lat, p.lon);
      const cx = ((bx - sx) / size) * W;
      const cy = ((by - sy) / size) * W;
      if (cx < 0 || cy < 0 || cx > W || cy > W) continue;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      this.ctx.fillStyle = "#4a3049";
      this.ctx.fill();
    }
  }

  private pointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        zoom: this.dispZoom,
      };
    }
  }

  private pointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const rect = this.canvas.getBoundingClientRect();
    const toBuffer = this.winSize() / rect.width;
    if (this.pointers.size === 1) {
      this.winCx -= (e.clientX - prev.x) * toBuffer;
      this.winCy -= (e.clientY - prev.y) * toBuffer;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch.dist > 0) {
        this.dispZoom = clamp(
          this.pinch.zoom * (dist / this.pinch.dist),
          ZOOM_MIN,
          ZOOM_MAX,
        );
      }
    }
    this.draw();
  }

  private pointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) this.settle();
  }

  private scheduleSettle(): void {
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settle(), 220);
  }

  /** Commit the gesture: snap the scale, recentre, refetch if the
   *  window sits too close to the buffer edge. */
  private settle(): void {
    if (!this.framing || !this.buffer) return;
    const center = this.bufferToLatLon(this.winCx, this.winCy);
    const rawScale = this.framing.scaleKm / this.dispZoom;
    const snapped = SNAP_KM.reduce((best, km) =>
      Math.abs(Math.log(km / rawScale)) < Math.abs(Math.log(best / rawScale))
        ? km
        : best,
    );
    const next: Framing = { lat: center.lat, lon: center.lon, scaleKm: snapped };
    const scaleChanged = snapped !== this.framing.scaleKm;
    this.framing = next;
    this.dispZoom = 1;
    this.onCommit(next);
    // Window (at the new framing) must sit inside the buffer with a
    // margin of half a window on every side, else refetch.
    const [cx, cy] = this.latLonToBuffer(next.lat, next.lon);
    const half = BUFFER_PX / BUFFER_FACTOR / 2;
    const margin = half * 0.5;
    if (
      scaleChanged ||
      cx - half < margin ||
      cy - half < margin ||
      cx + half > BUFFER_PX - margin ||
      cy + half > BUFFER_PX - margin
    ) {
      void this.refetch();
    } else {
      this.winCx = cx;
      this.winCy = cy;
      this.draw();
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
