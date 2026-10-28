/** PM-owned: changes require a ruling in specs/00_system.md before domain work. */
export interface VectorLayer {
  readonly id: string;
  readonly description?: string;
  readonly minzoom?: number;
  readonly maxzoom?: number;
  readonly fields?: Readonly<Record<string, string>>;
}

/** URLs resolve against the manifest URL. A supplied style is used intact. */
export interface MapManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly archive: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly tileType: "mvt";
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly bounds: readonly [number, number, number, number];
  readonly center: readonly [number, number, number];
  readonly vectorLayers: readonly VectorLayer[];
  readonly attribution: string;
  readonly style?: string;
}
