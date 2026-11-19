// Output routes: share sheet (primary on phones), file save (fallback),
// and browser print at exactly 48 mm width (for the home CUPS route).

// ----- save file names -----
// A web app cannot see what already exists at the save destination
// (the Downloads folder, or the app a share is handed to), so a fixed
// file name silently overwrites the previous map saved there. The
// default name therefore carries a to-the-second timestamp, making
// collisions impossible by construction; names handed out in this
// session are also remembered and get a -2, -3, ... suffix if the
// same second repeats. A name the user typed is used verbatim:
// picking a name is their intent, overwrite included. (Same rule as
// Voice2QR, 2026-11-19.)
const handedOutNames = new Set<string>();

export function defaultSaveName(base: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`
  );
}

export function sanitizeSaveName(raw: string): string {
  const name = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 100);
  if (!name) return "";
  return /\.png$/i.test(name) ? name : `${name}.png`;
}

/**
 * The name for one save/share action. While the field is untouched,
 * a fresh unique default is generated (and shown in the field). Once
 * the user edits the field, their text wins as-is.
 */
export function resolveSaveName(
  input: HTMLInputElement,
  edited: boolean,
  base: string,
): string {
  if (edited) {
    const typed = sanitizeSaveName(input.value);
    if (typed) return typed;
  }
  let name = defaultSaveName(base);
  if (handedOutNames.has(name)) {
    const stem = name.slice(0, -".png".length);
    let n = 2;
    while (handedOutNames.has(`${stem}-${n}.png`)) n++;
    name = `${stem}-${n}.png`;
  }
  handedOutNames.add(name);
  input.value = name;
  return name;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}

export async function shareCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<"shared" | "unsupported"> {
  const blob = await canvasToBlob(canvas);
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return "shared";
  }
  return "unsupported";
}

export async function saveCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function printCanvas(canvas: HTMLCanvasElement): void {
  const img = document.getElementById("print-img") as HTMLImageElement;
  img.src = canvas.toDataURL("image/png");
  // Give the browser a tick to lay out the print area.
  requestAnimationFrame(() => setTimeout(() => window.print(), 30));
}
