// Place-name / address resolution. Search pipeline (v0.5.0; the full
// rationale is documented in docs/requirements.md):
//
// Language "en": a single Nominatim search over the whole world.
//
// Language "ja":
// 1. A query with no Japanese characters (e.g. "Ponte di Rialto") goes
//    straight to a global Nominatim search — no GSI, no jp restriction.
// 2. An address-like query (丁目 / 番地 / digits with 番 or "-" or a
//    trailing number) first tries the GSI address search
//    (msearch.gsi.go.jp, backed by the CSIS simple geocoding service).
//    GSI fuzzy-matches unrelated addresses for non-address input, so a
//    GSI result is adopted only when its address agrees with the query
//    on the locality (municipality + town, prefecture aside) and on the
//    first block number when both sides state one.
// 3. Everything else — and any GSI miss — falls back to Nominatim
//    restricted to Japan, then to a global Nominatim retry when the
//    Japan-restricted search finds nothing (overseas places).
//
// Nominatim result rules (ported from the pocket-map skill's geocode):
// - station queries promote actual stations (type station / train_station
//   / halt) to the front; if only entrances/platforms/bus stops exist,
//   the station itself counts as not found and the user picks;
// - a result is "ambiguous" only when a similarly ranked alternative is
//   more than 0.7 km away (nearby hits usually describe the same complex).

import type { MatchPrecision } from "./viewport.ts";

export interface Candidate {
  lat: number;
  lon: number;
  displayName: string;
  importance: number;
  type: string;
  /** GSI only: how finely the returned title matched. The title level
   *  does NOT guarantee the point's position: at "ban" a measured point
   *  sat ~100 m off, in a neighbouring district. The UI warns whenever
   *  the level is coarser than "go". */
  precision?: MatchPrecision;
}

/** Finest address component present in a GSI title. */
function gsiPrecision(title: string): MatchPrecision {
  const t = normalizeAddress(title);
  if (/\d+号/.test(t)) return "go";
  if (/\d+番/.test(t)) return "ban";
  if (/\d+丁目/.test(t)) return "chome";
  if (/\d+$/.test(t)) return "ban"; // street-number (chiban) style title
  return "area";
}

export type GeocodeResult =
  | { status: "ok"; candidate: Candidate }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "notfound" };

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dy = (b.lat - a.lat) * 111.32;
  const dx =
    (b.lon - a.lon) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------- Nominatim

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  type?: string;
}

const STATION_TYPES = new Set(["station", "train_station", "halt"]);
const NOT_STATION_TYPES = new Set(["bus_stop", "subway_entrance", "platform"]);

async function fetchNominatim(
  query: string,
  countrycodes: string | null,
): Promise<NominatimItem[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "8",
    addressdetails: "1",
    dedupe: "1",
  });
  if (countrycodes) params.set("countrycodes", countrycodes);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  return (await res.json()) as NominatimItem[];
}

function processItems(items: NominatimItem[], query: string): GeocodeResult {
  if (!items.length) return { status: "notfound" };

  let candidates: Candidate[] = items.map((it) => ({
    lat: parseFloat(it.lat),
    lon: parseFloat(it.lon),
    displayName: it.display_name,
    importance: it.importance ?? 0,
    type: it.type ?? "",
  }));

  if (query.includes("駅") || /station/i.test(query)) {
    const stations = candidates.filter((c) => STATION_TYPES.has(c.type));
    if (stations.length) {
      candidates = [
        ...stations,
        ...candidates.filter((c) => !STATION_TYPES.has(c.type)),
      ];
    } else if (candidates.every((c) => NOT_STATION_TYPES.has(c.type))) {
      return { status: "ambiguous", candidates };
    }
  }

  const first = candidates[0];
  const alternatives = candidates
    .slice(1)
    .filter(
      (c) => c.importance >= first.importance * 0.8 && distanceKm(first, c) > 0.7,
    );
  if (alternatives.length) {
    return { status: "ambiguous", candidates: [first, ...alternatives.slice(0, 3)] };
  }
  return { status: "ok", candidate: first };
}

// ------------------------------------------------------- Japanese addresses

const HAS_JA = /[぀-ヿ一-鿿]/;
// Address-likeness is judged on the digit-normalised query: block markers
// (丁目・番地), a number before 番, a hyphenated number pair, or a trailing
// number (地番-style addresses such as 鎌倉市山ノ内8).
const ADDRESS_LIKE = /(?:丁目|番地|\d+番|\d+-\d+|\d+$)/;

function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/(\d)[ー−‐](?=\d)/g, "$1-");
}

const KANJI_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function kanjiNum(s: string): number {
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch in KANJI_DIGIT) {
      num = KANJI_DIGIT[ch];
    } else if (ch === "十") {
      total += (num || 1) * 10;
      num = 0;
    } else if (ch === "百") {
      total += (num || 1) * 100;
      num = 0;
    } else if (ch === "千") {
      total += (num || 1) * 1000;
      num = 0;
    }
  }
  return total + num;
}

/** Normalise an address string for comparison: arabic digits throughout. */
function normalizeAddress(s: string): string {
  return normalizeDigits(s)
    .replace(/\s+/g, "")
    .replace(/([一二三四五六七八九十百千]+)(?=丁目|番地|番|号|条)/g, (m) =>
      String(kanjiNum(m)),
    );
}

/** The part of a normalised address before its first number. */
function localityOf(normalized: string): string {
  const m = normalized.match(/^(.*?)(?=\d)/);
  return m ? m[1] : normalized;
}

function stripPrefecture(locality: string): string {
  return locality.replace(/^(?:東京都|北海道|..府|.{2,3}県)/, "");
}

/** The first number of a normalised address after its locality part. */
function firstNumberAfter(normalized: string, locality: string): number | null {
  const rest = normalized.slice(locality.length);
  const m = rest.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * GSI adoption check: GSI answers almost any input with some address, so
 * a hit counts only when it agrees with the query on locality (ignoring
 * the prefecture, which queries often omit) and on the first block
 * number when both sides state one.
 */
function gsiAdopts(query: string, title: string): boolean {
  const q = normalizeAddress(query);
  const t = normalizeAddress(title);
  const qLoc = localityOf(q);
  const tLoc = localityOf(t);
  if (!qLoc || !tLoc) return false;
  const qp = stripPrefecture(qLoc);
  const tp = stripPrefecture(tLoc);
  // Queries often omit the ward/city ("西新宿2丁目…" for a title of
  // "新宿区西新宿2丁目…"), so localities agree when one contains the
  // other at either end, not only on a shared prefix.
  const locOk =
    tp === qp ||
    tp.startsWith(qp) ||
    qp.startsWith(tp) ||
    tp.endsWith(qp) ||
    qp.endsWith(tp);
  if (!locOk) return false;
  // A municipality named in the query must appear in the title.
  for (let i = 1; i < qp.length; i++) {
    if ("市区町村".includes(qp[i])) {
      if (!t.includes(qp.slice(0, i + 1))) return false;
      break;
    }
  }
  const qn = firstNumberAfter(q, qLoc);
  const tn = firstNumberAfter(t, tLoc);
  if (qn !== null && tn !== null && qn !== tn) return false;
  return true;
}

interface GsiFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string };
}

/** GSI address search, adoption-checked. Returns null on any failure. */
async function searchGsi(query: string): Promise<Candidate[] | null> {
  const res = await fetch(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const features = (await res.json()) as GsiFeature[];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    const title = f.properties?.title;
    if (!coords || !title || !gsiAdopts(query, title)) continue;
    const key = `${coords[1].toFixed(5)},${coords[0].toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      lat: coords[1],
      lon: coords[0],
      displayName: title,
      importance: 1,
      type: "",
      precision: gsiPrecision(title),
    });
    if (candidates.length >= 5) break;
  }
  return candidates;
}

function isAddressLike(query: string): boolean {
  return ADDRESS_LIKE.test(normalizeDigits(query));
}

// ------------------------------------------------------------------- search

export async function searchPlace(
  query: string,
  lang: string,
): Promise<GeocodeResult> {
  if (lang !== "ja") {
    return processItems(await fetchNominatim(query, null), query);
  }
  if (!HAS_JA.test(query)) {
    return processItems(await fetchNominatim(query, null), query);
  }
  if (isAddressLike(query)) {
    const gsi = await searchGsi(query).catch(() => null);
    if (gsi && gsi.length === 1) return { status: "ok", candidate: gsi[0] };
    if (gsi && gsi.length > 1) return { status: "ambiguous", candidates: gsi };
  }
  const jpItems = await fetchNominatim(query, "jp");
  const jp = processItems(jpItems, query);
  if (jp.status !== "notfound") {
    // Guard: a Japan-restricted hit whose importance is negligible can
    // be a minor local POI that merely shares a famous foreign place's
    // name (measured: "ニューヨーク" → a pub in Fuchu, importance
    // 0.00009, vs New York City at 0.88 globally). When the global top
    // hit is a major place, prefer the global result set.
    const jpMaxImp = Math.max(0, ...jpItems.map((i) => i.importance ?? 0));
    if (jpMaxImp < 0.01) {
      const gItems = await fetchNominatim(query, null).catch(
        () => [] as NominatimItem[],
      );
      if (gItems.length && (gItems[0].importance ?? 0) >= 0.5) {
        return processItems(gItems, query);
      }
    }
    return jp;
  }
  return processItems(await fetchNominatim(query, null), query);
}
