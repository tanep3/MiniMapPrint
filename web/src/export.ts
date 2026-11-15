// Output routes: share sheet (primary on phones), file save (fallback),
// and browser print at exactly 48 mm width (for the home CUPS route).

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
