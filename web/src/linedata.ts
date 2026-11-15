// Line-style data source selection: vector tiles first (fast, local
// extraction), the Overpass endpoint race as fallback when tiles fail
// or cover nothing. This is a data-source fallback inside the line
// style — the style itself never silently changes.

import { fetchWays as fetchOverpassWays, type Way } from "./overpass";
import { fetchWaysFromTiles } from "./vectiles";
import type { Viewport } from "./viewport";

export async function fetchLineWays(vp: Viewport): Promise<Way[]> {
  try {
    return await fetchWaysFromTiles(vp);
  } catch {
    return fetchOverpassWays(vp);
  }
}
