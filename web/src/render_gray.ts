// Gray-style conversion via the pic2gray4px WASM core.
// The mosaic canvas is already at the exact output size. Conversion uses
// the illustration mode (no diffusion + inter-cell exchange), the warm
// channel mixer and the normal tone curve — the combination that read
// best on real maps — with unsharp fixed at 0.5 (the auto search
// flip-flopped between 0.25 and 0.5 on near-identical mosaics; contrast
// stays on auto). The packed 1-bit result is unpacked onto a canvas.

interface CoreModule {
  convert_rgba_adjusted: (
    rgba: Uint8Array,
    width: number,
    height: number,
    targetWidth: number | null,
    contrast: number | null,
    unsharp: number | null,
    passes: number,
    diffusion: boolean,
    mixerPresetName: string | null,
    mixerWeights: number[] | null,
    toneCurveName: string | null,
    localContrast: number | null,
    modeName: string | null,
    exchangeRounds: number | null,
  ) => {
    bits: Uint8Array;
    width: number;
    height: number;
    contrast_used: number;
    unsharp_used: number;
    diffusion_used: boolean;
    exchange_used: number;
    free: () => void;
  };
}

let corePromise: Promise<CoreModule> | null = null;

function loadCore(): Promise<CoreModule> {
  if (!corePromise) {
    corePromise = (async () => {
      // Resolve against the page URL, not the importing module: the
      // bundled script lives under assets/, so a module-relative
      // "./wasm/..." would miss the site-root wasm/ directory.
      const glueUrl = new URL("wasm/minimapprint_core.js", document.baseURI)
        .href;
      const wasmUrl = new URL(
        "wasm/minimapprint_core_bg.wasm",
        document.baseURI,
      ).href;
      const mod = (await import(/* @vite-ignore */ glueUrl)) as {
        default: (input: string) => Promise<unknown>;
      } & CoreModule;
      await mod.default(wasmUrl);
      return mod;
    })();
  }
  return corePromise;
}

export interface GrayResult {
  canvas: HTMLCanvasElement;
  contrastUsed: number;
  unsharpUsed: number;
}

export async function renderGray(mosaic: HTMLCanvasElement): Promise<GrayResult> {
  const core = await loadCore();
  const w = mosaic.width;
  const h = mosaic.height;
  const ctx = mosaic.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, w, h);
  const result = core.convert_rgba_adjusted(
    new Uint8Array(imageData.data.buffer),
    w,
    h,
    null, // target width: the mosaic is already at the output size
    null, // contrast: auto search
    0.5, // unsharp: fixed
    10, // passes
    true, // diffusion argument: ignored, the mode preset decides
    "warm", // channel mixer preset
    null, // mixer weights (the preset supplies them)
    "normal", // tone curve
    null, // local contrast: off
    "illustration", // mode: no diffusion + exchange
    null, // exchange rounds (the mode preset supplies them)
  );
  try {
    const outW = result.width;
    const outH = result.height;
    const rowBytes = Math.ceil(outW / 8);
    const out = document.createElement("canvas");
    out.width = w; // crop any even-size padding the core added
    out.height = h;
    const octx = out.getContext("2d")!;
    const outData = octx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = (result.bits[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit === 1 ? 255 : 0;
        const i = (y * w + x) * 4;
        outData.data[i] = v;
        outData.data[i + 1] = v;
        outData.data[i + 2] = v;
        outData.data[i + 3] = 255;
      }
    }
    octx.putImageData(outData, 0, 0);
    return {
      canvas: out,
      contrastUsed: result.contrast_used,
      unsharpUsed: result.unsharp_used,
    };
  } finally {
    result.free();
  }
}
