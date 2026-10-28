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

export type DocsGuideSlug =
  | "index"
  | "quickstart"
  | "authentication"
  | "maplibre"
  | "raster"
  | "static-maps"
  | "styles"
  | "api"
  | "examples";

export interface DocsGuideNavItem {
  readonly slug: DocsGuideSlug;
  readonly label: string;
  readonly href: string;
}

export interface DocsGuideCodeExample {
  readonly label: string;
  readonly language: string;
  readonly code: string;
}

export interface DocsGuideSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly callout?: string;
  readonly codeExamples?: ReadonlyArray<DocsGuideCodeExample>;
}

export interface DocsGuidePage {
  readonly slug: DocsGuideSlug;
  readonly title: string;
  readonly summary: string;
  readonly nav: ReadonlyArray<DocsGuideNavItem>;
  readonly sections: ReadonlyArray<DocsGuideSection>;
  readonly ctas: ReadonlyArray<{
    readonly label: string;
    readonly href: string;
    readonly action?: "create-project" | "open-dashboard" | "get-api-key";
  }>;
}

export interface OpenApiRoute {
  readonly method: "GET" | "HEAD" | "OPTIONS" | "POST";
  readonly path: string;
  readonly summary: string;
}

export type OpenApiMethodKey = "get" | "head" | "options" | "post";

export interface OpenApiOperation {
  readonly summary: string;
}

export type OpenApiPathMethods = Partial<Record<OpenApiMethodKey, OpenApiOperation>>;

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
  readonly paths: Record<string, OpenApiPathMethods>;
}

export interface DocsContext {
  readonly baseUrl: string;
}

export interface DocsError extends ContractError {
  readonly endpoint: string;
}
