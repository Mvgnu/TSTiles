export type MarketingPageSlug =
  | "landing"
  | "pricing"
  | "terms"
  | "privacy"
  | "dpa"
  | "acceptable-use"
  | "security"
  | "status"
  | "sign-in"
  | "sign-up";

export interface MarketingPlanCard {
  readonly planId: string;
  readonly includedRequests: number;
  readonly unitPricePerThousandRequests: number;
  readonly currency: string;
  readonly ctaLabel: string;
  readonly ctaHref: string;
}

export interface MarketingCodeSnippet {
  readonly label: string;
  readonly language: string;
  readonly code: string;
}

export interface MarketingSectionLink {
  readonly label: string;
  readonly href: string;
}

export interface MarketingSectionFaq {
  readonly question: string;
  readonly answer: string;
}

export interface MarketingSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly highlight?: string;
  readonly links?: ReadonlyArray<MarketingSectionLink>;
  readonly faqs?: ReadonlyArray<MarketingSectionFaq>;
  readonly snippets?: ReadonlyArray<MarketingCodeSnippet>;
}

export interface MarketingPage {
  readonly slug: MarketingPageSlug;
  readonly title: string;
  readonly summary: string;
  readonly eyebrow: string;
  readonly sections: ReadonlyArray<MarketingSection>;
  readonly primaryCta: {
    readonly label: string;
    readonly href: string;
  };
  readonly secondaryCta?: {
    readonly label: string;
    readonly href: string;
  };
  readonly planCards?: ReadonlyArray<MarketingPlanCard>;
  readonly legalLastUpdated?: string;
}
