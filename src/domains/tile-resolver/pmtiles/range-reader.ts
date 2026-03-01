import type { ObjectStore, RangeReadResult } from "../../storage/types";

export async function readTileRange(store: ObjectStore, key: string, start: number, end: number): Promise<RangeReadResult> {
  return store.getRange({
    key,
    start,
    end,
  });
}
