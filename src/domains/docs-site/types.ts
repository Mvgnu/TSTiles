import type { ContractError } from "../../contracts/types";

export interface DocsIndexSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export interface DocsIndex {
  readonly title: string;
  readonly version: string;
  readonly baseUrl: string;
  readonly sections: ReadonlyArray<DocsIndexSection>;
}

export interface OpenApiRoute {
  readonly method: "GET" | "HEAD" | "OPTIONS" | "POST";
  readonly path: string;
  readonly summary: string;
}

export interface ApiExample {
  readonly name: string;
  readonly description: string;
  readonly url: string;
}

export interface ExampleBundle {
  readonly quickstart: ReadonlyArray<ApiExample>;
  readonly mapLibre: ReadonlyArray<ApiExample>;
  readonly leaflet: ReadonlyArray<ApiExample>;
  readonly raster: ReadonlyArray<ApiExample>;
  readonly staticMaps: ReadonlyArray<ApiExample>;
}

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
  };
  readonly paths: Record<string, unknown>;
}

export interface DocsContext {
  readonly baseUrl: string;
}

export interface DocsError extends ContractError {
  readonly endpoint: string;
}
