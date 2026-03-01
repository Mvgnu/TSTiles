import { isTileCoordinates } from "../../../contracts/contracts";
import { ContractError, ContractErrorCode } from "../../../contracts/types";
import { ResolverError, ResolverErrorCode } from "../types";

const tileCoordinatePathPattern = /^\/?tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;
const MAX_ZOOM = 30;

export interface ParsedTilePath {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export function parseTilePath(path: string): ParsedTilePath {
  const match = tileCoordinatePathPattern.exec(path);
  if (!match || match.length !== 4) {
    throw new ResolverError(ResolverErrorCode.BAD_COORDINATES);
  }
  const parsed: ParsedTilePath = {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
  };
  const validation = validateTileCoordinates(parsed);
  if (validation !== null) {
    throw new ResolverError(ResolverErrorCode.BAD_COORDINATES);
  }
  return parsed;
}

function inTileRange(z: number, x: number, y: number): boolean {
  if (z < 0 || z > MAX_ZOOM) {
    return false;
  }
  const axisLimit = 2 ** z;
  return x >= 0 && y >= 0 && x < axisLimit && y < axisLimit;
}

export function validateTileCoordinates(value: unknown): ContractError | null {
  if (!isTileCoordinates(value)) {
    return new ContractError(ContractErrorCode.SCHEMA_INVALID, "RESOLVER_BAD_COORDINATES");
  }
  if (!inTileRange(value.z, value.x, value.y)) {
    return new ContractError(ContractErrorCode.SCHEMA_INVALID, "RESOLVER_BAD_COORDINATES");
  }
  return null;
}
