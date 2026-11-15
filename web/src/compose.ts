// Final composition: title, pins, legend, scale bar, north arrow and
// attribution are drawn AFTER conversion so they stay crisp (the skill's
// design rule). Layout constants are the skill's 384x512 values, scaled
// by s = outW / 384.

import type { Place } from "./viewport";

export interface MapBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function mapBox(placeCount: number, s: number): MapBox {
  const raw =
    placeCount === 2
      ? { x: 19, y: 49, w: 346, h: 346 }
      : { x: 6, y: 49, w: 372, h: 372 };
  return {
    x: Math.round(raw.x * s),
    y: Math.round(raw.y * s),
    w: Math.round(raw.w * s),
    h: Math.round(raw.h * s),
  };
}

const FONT = `"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans CJK JP","Yu Gothic UI",sans-serif`;

function fitText(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxW: number,
  startPx: number,
  minPx: number,
): { text: string; size: number } {
  for (let size = startPx; size >= minPx; size -= 1) {
    ctx.font = `700 ${size}px ${FONT}`;
    if (ctx.measureText(value).width <= maxW) return { text: value, size };
  }
  ctx.font = `700 ${minPx}px ${FONT}`;
  let v = value;
  while (v && ctx.measureText(v + "…").width > maxW) v = v.slice(0, -1);
  return { text: v + "…", size: minPx };
}

export interface ComposeOptions {
  places: Place[];
  /** Pin positions in box pixel coordinates, projected with the style's
   *  own projection so they sit on the right features. */
  pins: Array<[number, number]>;
  actualKm: number;
  box: MapBox;
  outW: number;
  outH: number;
  s: number;
}

export function compose(
  base: HTMLCanvasElement,
  opts: ComposeOptions,
): HTMLCanvasElement {
  const { places, pins, actualKm, box, outW, outH, s } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(base, box.x, box.y);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1, s);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  // Title: "A → B"
  const title = places.map((p) => p.label).join(" → ");
  const tf = fitText(ctx, title, 364 * s, 22 * s, 12 * s);
  ctx.font = `700 ${tf.size}px ${FONT}`;
  ctx.fillText(tf.text, 9 * s, 6 * s);

  // Pins
  const abs = pins.map(([x, y]): [number, number] => [x + box.x, y + box.y]);
  const haloText = (text: string, x: number, y: number, size: number) => {
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#000000";
    ctx.fillText(text, x, y);
  };
  const circle = (x: number, y: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (
    abs.length === 2 &&
    Math.hypot(abs[0][0] - abs[1][0], abs[0][1] - abs[1][1]) < 30 * s
  ) {
    const x = (abs[0][0] + abs[1][0]) / 2;
    const y = (abs[0][1] + abs[1][1]) / 2;
    circle(x, y, 12 * s, "#ffffff");
    circle(x, y, 8 * s, "#000000");
    circle(x, y, 3 * s, "#ffffff");
    haloText("1+2", x + 12 * s, y - 11 * s, 16 * s);
  } else {
    abs.forEach(([x, y], i) => {
      circle(x, y, 12 * s, "#ffffff");
      if (i === 1) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(x - 8 * s, y - 8 * s, 16 * s, 16 * s);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x - 3 * s, y - 3 * s, 6 * s, 6 * s);
      } else {
        circle(x, y, 8 * s, "#000000");
        circle(x, y, 3 * s, "#ffffff");
      }
      if (abs.length > 1) haloText(String(i + 1), x + 10 * s, y - 13 * s, 19 * s);
    });
  }

  // Legend for two places
  if (places.length === 2) {
    places.forEach((p, i) => {
      const lf = fitText(ctx, `${i + 1}  ${p.label}`, 350 * s, 17 * s, 12 * s);
      ctx.font = `700 ${lf.size}px ${FONT}`;
      ctx.fillStyle = "#000000";
      ctx.fillText(lf.text, 12 * s, (398 + i * 22) * s);
    });
  }

  // Scale bar
  const scaleKm =
    actualKm <= 1 ? 0.1 : actualKm <= 5 ? 0.5 : actualKm <= 10 ? 1 : 2;
  const px = (scaleKm / actualKm) * box.w;
  const yBar = (places.length === 2 ? 470 : 454) * s;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4 * s;
  ctx.beginPath();
  ctx.moveTo(10 * s, yBar);
  ctx.lineTo(10 * s + px, yBar);
  ctx.stroke();
  ctx.lineWidth = 2 * s;
  for (const x of [10 * s, 10 * s + px]) {
    ctx.beginPath();
    ctx.moveTo(x, yBar - 5 * s);
    ctx.lineTo(x, yBar + 5 * s);
    ctx.stroke();
  }
  ctx.font = `700 ${17 * s}px ${FONT}`;
  ctx.fillStyle = "#000000";
  ctx.fillText(`${scaleKm} km`, 10 * s, yBar - 27 * s);

  // North arrow
  const ay = (places.length === 2 ? 447 : 431) * s;
  ctx.beginPath();
  ctx.moveTo(358 * s, ay);
  ctx.lineTo(348 * s, ay + 19 * s);
  ctx.lineTo(368 * s, ay + 19 * s);
  ctx.closePath();
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.font = `700 ${15 * s}px ${FONT}`;
  ctx.fillText("N", 350 * s, ay + 23 * s);

  // Attribution (ODbL requirement, always present)
  ctx.font = `700 ${10 * s}px ${FONT}`;
  ctx.fillText("© OpenStreetMap contributors / ODbL", 8 * s, 485 * s);

  return canvas;
}
