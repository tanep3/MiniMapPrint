import "./style.css";
import { initI18n, setLang, getLang, t } from "./i18n";
import { searchPlace, type Candidate } from "./geocode";
import {
  computeViewport,
  projectLinear,
  projectMercator,
  SNAP_KM,
  type Place,
  type Viewport,
} from "./viewport";
import { fetchWays } from "./overpass";
import { fetchMosaic } from "./tiles";
import { renderLine } from "./render_line";
import { renderGray } from "./render_gray";
import { compose, mapBox, type MapBox } from "./compose";
import { shareCanvas, saveCanvas, printCanvas } from "./export";
import { initPwa } from "./pwa";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface FieldState {
  query: string;
  place: Place | null;
}
const fields: Record<1 | 2, FieldState> = {
  1: { query: "", place: null },
  2: { query: "", place: null },
};

interface RunContext {
  places: Place[];
  vp: Viewport;
  outW: number;
  outH: number;
  s: number;
  box: MapBox;
}
let lastRun: RunContext | null = null;
let modalCanvas: HTMLCanvasElement | null = null;
let modalName = "minimapprint.png";

function scaleLabel(idx: number): string {
  const km = SNAP_KM[idx];
  return km < 1 ? `${km * 1000} m` : `${km} km`;
}

function updateScaleLabel(): void {
  const idx = Number($<HTMLInputElement>("scale").value);
  $("scale-value").textContent = scaleLabel(idx);
}

function showError(msg: string | null): void {
  const el = $("error");
  if (msg) {
    el.textContent = msg;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function renderCandidates(
  which: 1 | 2,
  candidates: Candidate[],
  query: string,
): void {
  const box = $(`candidates${which}`);
  box.innerHTML = "";
  const head = document.createElement("div");
  head.textContent = t("pickCandidate");
  head.style.fontWeight = "700";
  head.style.fontSize = "13px";
  box.appendChild(head);
  candidates.slice(0, 5).forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.displayName;
    btn.addEventListener("click", () => {
      fields[which] = {
        query,
        place: { lat: c.lat, lon: c.lon, label: query },
      };
      box.hidden = true;
      box.innerHTML = "";
      void generate();
    });
    box.appendChild(btn);
  });
  box.hidden = false;
}

async function resolveField(
  which: 1 | 2,
): Promise<"ok" | "pending" | "notfound"> {
  const input = $<HTMLInputElement>(`place${which}`);
  const query = input.value.trim();
  if (!query) return "ok";
  if (fields[which].query === query && fields[which].place) return "ok";
  const result = await searchPlace(query, getLang());
  if (result.status === "notfound") return "notfound";
  if (result.status === "ambiguous") {
    renderCandidates(which, result.candidates, query);
    return "pending";
  }
  fields[which] = {
    query,
    place: {
      lat: result.candidate.lat,
      lon: result.candidate.lon,
      label: query,
    },
  };
  return "ok";
}

function makeCard(style: "line" | "gray"): {
  card: HTMLElement;
  setPending: () => void;
  setFailed: (retry: () => void) => void;
  setDone: (canvas: HTMLCanvasElement) => void;
} {
  const card = document.createElement("div");
  card.className = "result-card";
  const chip = document.createElement("span");
  chip.className = `chip ${style}`;
  chip.textContent = style === "line" ? t("styleLine") : t("styleGray");
  card.appendChild(chip);
  const body = document.createElement("div");
  card.appendChild(body);

  const setPending = () => {
    body.innerHTML = "";
    const d = document.createElement("div");
    d.className = "pending";
    d.textContent = t("generating");
    body.appendChild(d);
  };
  const setFailed = (retry: () => void) => {
    body.innerHTML = "";
    const d = document.createElement("div");
    d.className = "failed";
    d.textContent =
      style === "line" ? t("lineFailed") : t("grayFailed");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = t("retry");
    btn.style.marginLeft = "10px";
    btn.addEventListener("click", retry);
    d.appendChild(btn);
    body.appendChild(d);
  };
  const setDone = (canvas: HTMLCanvasElement) => {
    body.innerHTML = "";
    const img = document.createElement("img");
    img.className = "map";
    img.src = canvas.toDataURL("image/png");
    img.alt = style;
    const name = `minimapprint-${style}.png`;
    img.addEventListener("click", () => openModal(canvas, name));
    body.appendChild(img);
    const actions = document.createElement("div");
    actions.className = "actions";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    actions.appendChild(
      mk(t("share"), () => void shareCanvas(canvas, name).catch(() => {})),
    );
    actions.appendChild(mk(t("save"), () => void saveCanvas(canvas, name)));
    actions.appendChild(mk(t("print"), () => printCanvas(canvas)));
    body.appendChild(actions);
  };
  return { card, setPending, setFailed, setDone };
}

async function runLine(ctx: RunContext, card: ReturnType<typeof makeCard>) {
  card.setPending();
  try {
    const ways = await fetchWays(ctx.vp);
    const base = renderLine(ways, ctx.vp, ctx.box.w, ctx.box.h, ctx.s);
    const pins = ctx.places.map(
      (p) =>
        projectLinear(p.lat, p.lon, ctx.vp, ctx.box.w, ctx.box.h) as [
          number,
          number,
        ],
    );
    card.setDone(
      compose(base, {
        places: ctx.places,
        pins,
        actualKm: ctx.vp.actualKm,
        box: ctx.box,
        outW: ctx.outW,
        outH: ctx.outH,
        s: ctx.s,
      }),
    );
  } catch {
    card.setFailed(() => void runLine(ctx, card));
  }
}

async function runGray(ctx: RunContext, card: ReturnType<typeof makeCard>) {
  card.setPending();
  try {
    const { canvas: mosaic } = await fetchMosaic(ctx.vp, ctx.box.w, ctx.box.h);
    const gray = await renderGray(mosaic);
    const pins = ctx.places.map(
      (p) =>
        projectMercator(p.lat, p.lon, ctx.vp, ctx.box.w, ctx.box.h) as [
          number,
          number,
        ],
    );
    card.setDone(
      compose(gray.canvas, {
        places: ctx.places,
        pins,
        actualKm: ctx.vp.actualKm,
        box: ctx.box,
        outW: ctx.outW,
        outH: ctx.outH,
        s: ctx.s,
      }),
    );
  } catch {
    card.setFailed(() => void runGray(ctx, card));
  }
}

async function generate(): Promise<void> {
  showError(null);
  const btn = $<HTMLButtonElement>("generate");
  const q1 = $<HTMLInputElement>("place1").value.trim();
  if (!q1) {
    showError(t("needPlace"));
    return;
  }
  btn.disabled = true;
  btn.textContent = t("generating");
  try {
    const r1 = await resolveField(1);
    if (r1 === "notfound") {
      showError(t("notFound", { q: q1 }));
      return;
    }
    if (r1 === "pending") return;
    const q2 = $<HTMLInputElement>("place2").value.trim();
    if (q2) {
      const r2 = await resolveField(2);
      if (r2 === "notfound") {
        showError(t("notFound", { q: q2 }));
        return;
      }
      if (r2 === "pending") return;
    } else {
      fields[2] = { query: "", place: null };
    }

    const places = [fields[1].place!, ...(fields[2].place ? [fields[2].place] : [])];
    const scaleKm = SNAP_KM[Number($<HTMLInputElement>("scale").value)];
    let vp: Viewport;
    try {
      vp = computeViewport(places, scaleKm);
    } catch {
      showError(t("tooFar"));
      return;
    }

    const printer =
      document.querySelector<HTMLInputElement>('input[name="printer"]:checked')
        ?.value ?? "200";
    const outW = printer === "300" ? 576 : 384;
    const outH = printer === "300" ? 768 : 512;
    const s = outW / 384;
    const box = mapBox(places.length, s);
    const ctx: RunContext = { places, vp, outW, outH, s, box };
    lastRun = ctx;

    const note = $("expanded-note");
    if (vp.expandedToKm !== null) {
      const km =
        vp.expandedToKm % 1 === 0
          ? String(vp.expandedToKm)
          : vp.expandedToKm.toFixed(1);
      note.textContent = t("expanded", { km });
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    const resultSection = $("result");
    resultSection.hidden = false;
    const cards = $("result-cards");
    cards.innerHTML = "";
    const lineCard = makeCard("line");
    const grayCard = makeCard("gray");
    cards.appendChild(lineCard.card);
    cards.appendChild(grayCard.card);
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    await Promise.allSettled([runLine(ctx, lineCard), runGray(ctx, grayCard)]);
  } finally {
    btn.disabled = false;
    btn.textContent = t("generate");
  }
}

function openModal(canvas: HTMLCanvasElement, name: string): void {
  modalCanvas = canvas;
  modalName = name;
  const img = $<HTMLImageElement>("modal-img");
  img.src = canvas.toDataURL("image/png");
  $("modal").hidden = false;
}

function closeModal(): void {
  $("modal").hidden = true;
  modalCanvas = null;
}

function init(): void {
  initI18n();
  void initPwa();

  const labels = $("scale-labels");
  SNAP_KM.forEach((km) => {
    const sp = document.createElement("span");
    sp.textContent = km < 1 ? `${km * 1000}m` : `${km}km`;
    labels.appendChild(sp);
  });
  updateScaleLabel();
  $<HTMLInputElement>("scale").addEventListener("input", updateScaleLabel);

  $<HTMLButtonElement>("lang-toggle").addEventListener("click", () => {
    setLang(getLang() === "ja" ? "en" : "ja");
    updateScaleLabel();
  });
  $<HTMLButtonElement>("generate").addEventListener("click", () => {
    void generate();
  });
  for (const id of ["place1", "place2"] as const) {
    $<HTMLInputElement>(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void generate();
      }
    });
  }

  $<HTMLButtonElement>("modal-close").addEventListener("click", closeModal);
  $("modal").addEventListener("click", (e) => {
    if (e.target === $("modal")) closeModal();
  });
  $<HTMLButtonElement>("modal-share").addEventListener("click", () => {
    if (modalCanvas) void shareCanvas(modalCanvas, modalName).catch(() => {});
  });
  $<HTMLButtonElement>("modal-save").addEventListener("click", () => {
    if (modalCanvas) void saveCanvas(modalCanvas, modalName);
  });
  $<HTMLButtonElement>("modal-print").addEventListener("click", () => {
    if (modalCanvas) printCanvas(modalCanvas);
  });
}

init();
