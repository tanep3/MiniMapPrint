// Place-name resolution via Nominatim.
// Rules ported from the pocket-map skill (make_map.py `geocode`):
// - station queries promote actual stations (type station / train_station
//   / halt) to the front; if only entrances/platforms/bus stops exist,
//   the station itself counts as not found and the user picks;
// - a result is "ambiguous" only when a similarly ranked alternative is
//   more than 0.7 km away (nearby hits usually describe the same complex).

export interface Candidate {
  lat: number;
  lon: number;
  displayName: string;
  importance: number;
  type: string;
}

export type GeocodeResult =
  | { status: "ok"; candidate: Candidate }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "notfound" };

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
  type?: string;
}

function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dy = (b.lat - a.lat) * 111.32;
  const dx =
    (b.lon - a.lon) * 111.32 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

const STATION_TYPES = new Set(["station", "train_station", "halt"]);
const NOT_STATION_TYPES = new Set(["bus_stop", "subway_entrance", "platform"]);

export async function searchPlace(
  query: string,
  lang: string,
): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "8",
    addressdetails: "1",
    dedupe: "1",
  });
  if (lang === "ja") params.set("countrycodes", "jp");
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const items = (await res.json()) as NominatimItem[];
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
