export function probeOutput(bytes: Uint8Array): { isLikelyPmTiles: boolean; byteSize: number } {
  return {
    isLikelyPmTiles: bytes.byteLength > 0,
    byteSize: bytes.byteLength,
  };
}
