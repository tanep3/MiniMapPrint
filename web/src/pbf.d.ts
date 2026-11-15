// pbf@3 ships no TypeScript types; @mapbox/vector-tile only needs the
// Pbf reader object passed through, so a minimal declaration suffices.
declare module "pbf" {
  export default class Pbf {
    constructor(buffer?: Uint8Array);
    readFields<T>(
      readField: (tag: number, result: T, pbf: Pbf) => void,
      result: T,
      end?: number,
    ): T;
    [key: string]: unknown;
  }
}
