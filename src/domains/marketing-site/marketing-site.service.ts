import { getExamples } from "../docs-site/docs-site.service";
import { listBillingPlans } from "../metering/metering.service";
import type { MarketingPage, MarketingPageSlug, MarketingPlanCard, MarketingSection } from "./types";

const legalLastUpdated = "2026-03-07";
const marketingPageSlugs = new Set<MarketingPageSlug>([
  "landing",
  "pricing",
  "terms",
  "privacy",
  "dpa",
  "acceptable-use",
  "security",
  "status",
  "sign-in",
  "sign-up",
]);

function normalizeMarketingPageSlug(value: unknown): MarketingPageSlug {
  if (typeof value !== "string") {
    throw new Error("MARKETING_PAGE_NOT_FOUND");
  }
  const normalized = value.trim();
  if (!marketingPageSlugs.has(normalized as MarketingPageSlug)) {
    throw new Error("MARKETING_PAGE_NOT_FOUND");
  }
  return normalized as MarketingPageSlug;
}

function cloneSnippet(snippet: NonNullable<MarketingSection["snippets"]>[number]): NonNullable<MarketingSection["snippets"]>[number] {
  return {
    label: snippet.label,
    language: snippet.language,
    code: snippet.code,
  };
}

function cloneSection(section: MarketingSection): MarketingSection {
  return {
    id: section.id,
    title: section.title,
    body: section.body,
    highlight: section.highlight,
    links: section.links?.map((link) => ({
      label: link.label,
      href: link.href,
    })),
    faqs: section.faqs?.map((faq) => ({
      question: faq.question,
      answer: faq.answer,
    })),
    snippets: section.snippets?.map((snippet) => cloneSnippet(snippet)),
  };
}

function clonePlanCard(plan: MarketingPlanCard): MarketingPlanCard {
  return {
    planId: plan.planId,
    includedRequests: plan.includedRequests,
    unitPricePerThousandRequests: plan.unitPricePerThousandRequests,
    currency: plan.currency,
    ctaLabel: plan.ctaLabel,
    ctaHref: plan.ctaHref,
  };
}

function clonePage(page: MarketingPage): MarketingPage {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    eyebrow: page.eyebrow,
    sections: page.sections.map((section) => cloneSection(section)),
    primaryCta: {
      label: page.primaryCta.label,
      href: page.primaryCta.href,
    },
    secondaryCta: page.secondaryCta
      ? {
        label: page.secondaryCta.label,
        href: page.secondaryCta.href,
      }
      : undefined,
    planCards: page.planCards?.map((plan) => clonePlanCard(plan)),
    legalLastUpdated: page.legalLastUpdated,
  };
}

function buildPricingCards(): ReadonlyArray<MarketingPlanCard> {
  return listBillingPlans()
    .sort((left, right) => left.freeAllowancePerMonth - right.freeAllowancePerMonth)
    .map((plan) => ({
      planId: plan.planId,
      includedRequests: plan.freeAllowancePerMonth,
      unitPricePerThousandRequests: plan.unitPricePerThousandRequests,
      currency: plan.currency,
      ctaLabel: plan.planId === "free" ? "Start free" : "Upgrade with Stripe",
      ctaHref: plan.planId === "free" ? "/sign-up" : "/sign-up?plan=pro",
    }));
}

async function buildSnippet(): Promise<string> {
  const examples = await getExamples();
  const styleUrl = examples.mapLibre[0]?.url ?? "/v1/styles/basic/style.json?access_token=YOUR_TOKEN";
  return `import maplibregl from "maplibre-gl";\n\nnew maplibregl.Map({\n  container: "map",\n  style: "${styleUrl}",\n  center: [10.7522, 59.9139],\n  zoom: 5,\n});`;
}

async function buildLandingSections(): Promise<ReadonlyArray<MarketingSection>> {
  return [
    {
      id: "what-you-get",
      title: "Vector and raster map hosting",
      body: "Serve vector tiles, strictly versioned Mapbox styles, and high-fidelity raster maps. Avoid complex dashboard setups and deploy reliable map delivery directly to your applications.",
      highlight: "Simple map infrastructure built for maximum reliability.",
    },
    {
      id: "how-it-works",
      title: "Seamless integration",
      body: "Create a workspace, issue a project API key, embed the MapLibre snippet, and start serving maps immediately. Billing is managed securely via Stripe.",
      snippets: [{
        label: "MapLibre GL JS",
        language: "js",
        code: await buildSnippet(),
      }],
    },
    {
      id: "docs",
      title: "API specifications",
      body: "Review structured documentation for authorization, raster map generation, and style versioning. Test endpoints and view real-time logs directly in the app.",
      highlight: "View our quickstart guide to serve your first vector map in minutes.",
      links: [
        { label: "Quickstart", href: "/docs/quickstart" },
        { label: "Authentication", href: "/docs/authentication" },
        { label: "Raster", href: "/docs/raster" },
        { label: "Static Maps", href: "/docs/static-maps" },
        { label: "Styles", href: "/docs/styles" },
      ],
    },
  ];
}

function buildLegalSections(title: string, body: string, highlight: string): ReadonlyArray<MarketingSection> {
  return [
    {
      id: "summary",
      title,
      body,
      highlight,
    },
  ];
}

function buildAuthSections(mode: "sign-in" | "sign-up"): ReadonlyArray<MarketingSection> {
  return [
    {
      id: "auth",
      title: mode === "sign-in" ? "Sign in" : "Create workspace",
      body: "Access your account to manage project keys, published style configurations, and monthly request usage.",
      highlight: mode === "sign-in"
        ? "Secure email and password sign-in with verification and recovery flows."
        : "Create a verified workspace for your team.",
    },
  ];
}

async function buildMarketingPages(): Promise<Readonly<Record<MarketingPageSlug, MarketingPage>>> {
  return {
    landing: {
      slug: "landing",
      title: "Fast, reliable map delivery for developers",
      summary: "Serve high-performance vector tiles, published style sheets, and raster or static maps. Simple pricing, detailed telemetry, and Stripe-managed billing.",
      eyebrow: "Hosted Map Server",
      sections: await buildLandingSections(),
      primaryCta: {
        label: "Get started free",
        href: "/sign-up",
      },
      secondaryCta: {
        label: "Read the docs",
        href: "/docs/quickstart",
      },
      planCards: buildPricingCards(),
    },
    pricing: {
      slug: "pricing",
      title: "Simple, usage-based pricing",
      summary: "Predictable plans that scale with your application requests. View usage in real-time.",
      eyebrow: "Pricing plans",
      sections: [
        {
          id: "requests",
          title: "Metered requests",
          body: "Vector tiles, raster tiles, and static map requests are counted under a unified monthly allowance. Usage stats match raw logs exactly.",
        },
        {
          id: "overage",
          title: "Overage handling",
          body: "When your request volume exceeds the plan's included allowance, usage continues seamlessly at a flat rate per 1,000 additional requests.",
          highlight: "Request metering is updated in real-time across all regions.",
        },
        {
          id: "billing",
          title: "Stripe billing",
          body: "Subscriptions, renewals, checkout flows, and payment details are managed entirely through secure Stripe-hosted portals.",
          highlight: "Your billing status is mirrored securely via Stripe webhooks.",
        },
        {
          id: "faq",
          title: "Plan changes and usage visibility",
          body: "Free workspaces can upgrade through Stripe Checkout. Paid workspaces manage plan changes, cancellations, and payment methods in the Stripe Customer Portal. The app shows mirrored status, current billing email, renewal timing, and included allowance usage without attempting to replace Stripe.",
          faqs: [
            {
              question: "How do plan changes happen?",
              answer: "Upgrades start in Stripe Checkout, while renewals, cancellations, and payment-method changes happen in the Stripe Customer Portal. The app only reflects mirrored webhook state after Stripe confirms the change.",
            },
            {
              question: "Where do I manage billing details?",
              answer: "Use the billing portal from pricing or the app billing page. That is the source of truth for invoices, payment methods, cancellation, and resume flows.",
            },
            {
              question: "How do I know when usage is getting close to limits?",
              answer: "The app overview, project usage pages, and billing surface show included allowance usage so quota pressure is visible before retry loops or production incidents become the signal.",
            },
          ],
        },
      ],
      primaryCta: {
        label: "Start free",
        href: "/sign-up",
      },
      secondaryCta: {
        label: "Read billing docs",
        href: "/docs/api",
      },
      planCards: buildPricingCards(),
    },
    terms: {
      slug: "terms",
      title: "Terms of Service",
      summary: "Baseline commercial terms for a developer infrastructure product.",
      eyebrow: "Legal",
      sections: buildLegalSections(
        "Service use",
        "Use the service lawfully, keep credentials scoped to your own projects, and do not attempt to abuse, scrape, or degrade the platform. Paid billing state and subscription management are handled through Stripe-hosted surfaces, while operational controls remain internal.",
        "These terms are a product-ready baseline, not a substitute for jurisdiction-specific review before production launch.",
      ),
      primaryCta: {
        label: "Privacy Policy",
        href: "/legal/privacy",
      },
      secondaryCta: {
        label: "Acceptable Use",
        href: "/legal/acceptable-use",
      },
      legalLastUpdated,
    },
    privacy: {
      slug: "privacy",
      title: "Privacy Policy",
      summary: "Core privacy commitments for sessions, billing metadata, and product usage.",
      eyebrow: "Legal",
      sections: buildLegalSections(
        "Data handling",
        "The service stores the minimum data needed to operate project access, workspace membership, authenticated product access, billing state mirrored from Stripe, and request usage telemetry. Stripe remains the payment processor for checkout and subscription management, while the product mirrors only the billing state needed for customer UX.",
        "If analytics or additional identity/session tooling are introduced, this page will be updated before that data is collected.",
      ),
      primaryCta: {
        label: "Terms of Service",
        href: "/legal/terms",
      },
      secondaryCta: {
        label: "Data Processing Addendum",
        href: "/legal/dpa",
      },
      legalLastUpdated,
    },
    dpa: {
      slug: "dpa",
      title: "Data Processing Addendum",
      summary: "Baseline processor and subprocessor expectations for teams evaluating the service as paid infrastructure.",
      eyebrow: "Legal",
      sections: buildLegalSections(
        "Processor boundary",
        "TSTiles processes limited operational data needed to authenticate workspace access, meter requests, deliver maps, and mirror Stripe-managed billing state. Stripe remains the payment processor for checkout, invoicing, subscription management, and payment method handling.",
        "Customers that require a signed DPA can use this page as the product summary and attach the executed agreement through their procurement process.",
      ),
      primaryCta: {
        label: "Privacy Policy",
        href: "/legal/privacy",
      },
      secondaryCta: {
        label: "Security",
        href: "/security",
      },
      legalLastUpdated,
    },
    "acceptable-use": {
      slug: "acceptable-use",
      title: "Acceptable Use Policy",
      summary: "The service is for lawful map delivery, not abuse or credential misuse.",
      eyebrow: "Legal",
      sections: [
        {
          id: "scraping",
          title: "Abusive scraping",
          body: "Do not use the service for abusive or unauthorized scraping patterns that degrade shared delivery, conceal customer attribution, or treat the platform like an unmetered bulk export surface.",
          highlight: "Normal product traffic is expected. Unbounded extraction or attribution evasion is not.",
        },
        {
          id: "illegal-content",
          title: "Illegal content and unlawful use",
          body: "Do not use the service to distribute illegal content, support unlawful activity, or route map delivery through projects that exist primarily to evade jurisdictional or contractual restrictions.",
        },
        {
          id: "credentials",
          title: "Credential misuse",
          body: "Project tokens must stay scoped to the workspace and integration they were issued for. Credential sharing, resale, or attempts to mask attribution across unrelated tenants are prohibited.",
        },
        {
          id: "service-abuse",
          title: "Service abuse",
          body: "Denial-of-service attempts, intentional quota evasion, payment evasion, or repeated attempts to interfere with hosted delivery, billing handoff, or authenticated app access are grounds for suspension.",
          highlight: "Credential misuse and service abuse should be grounds for suspension.",
        },
      ],
      primaryCta: {
        label: "Terms of Service",
        href: "/legal/terms",
      },
      secondaryCta: {
        label: "Privacy Policy",
        href: "/legal/privacy",
      },
      legalLastUpdated,
    },
    security: {
      slug: "security",
      title: "Security",
      summary: "How to report issues, what the hosted surface covers, and where Stripe-managed billing boundaries begin and end.",
      eyebrow: "Trust",
      sections: buildLegalSections(
        "Reporting and scope",
        `Security reports should be sent to ${process.env.SECURITY_CONTACT_EMAIL || "security@tstiles.com"}. Customer-facing scopes include hosted map delivery, project-scoped access tokens, the authenticated app console, and Stripe-linked billing surfaces. Stripe remains the source of truth for checkout, invoicing, payment methods, and subscription management.`,
        "Send reproducible reports with affected route, token scope, workspace impact, and whether the issue touches public delivery, authenticated console access, or billing handoff.",
      ),
      primaryCta: {
        label: "Email security",
        href: `mailto:${process.env.SECURITY_CONTACT_EMAIL || "security@tstiles.com"}?subject=Security%20report`,
      },
      secondaryCta: {
        label: "Status",
        href: "/status",
      },
      legalLastUpdated,
    },
    status: {
      slug: "status",
      title: "Status",
      summary: "Operational guidance for the public product surface and the machine-readable liveness endpoint behind it.",
      eyebrow: "Trust",
      sections: [
        {
          id: "status-overview",
          title: "Operational checks",
          body: "The service exposes `/v1/health` for automated liveness checks. This page is the human-readable operational surface so customers can understand what the health endpoint covers before relying on it in scripts or external monitors.",
          highlight: "Use `/status` for trust context and `/v1/health` for automation.",
        },
        {
          id: "expected-behavior",
          title: "What healthy looks like",
          body: "A healthy platform should serve public docs, resolve authenticated app sessions, and answer tile or metadata requests within normal route-specific behavior. Missing PMTiles artifacts are delivery issues, not necessarily full platform outages, and should surface as route-specific errors instead of misleading global downtime.",
        },
        {
          id: "escalation",
          title: "Escalation",
          body: "When reporting incidents, include the path checked, approximate time, workspace or token scope if relevant, and whether the issue affected public pages, authenticated app access, or map delivery. Security-sensitive issues should still be reported through the security contact.",
        },
      ],
      primaryCta: {
        label: "Health endpoint",
        href: "/v1/health",
      },
      secondaryCta: {
        label: "Security",
        href: "/security",
      },
    },
    "sign-in": {
      slug: "sign-in",
      title: "Sign in",
      summary: "Sign in to manage your maps, keys, and billing details.",
      eyebrow: "Account access",
      sections: buildAuthSections("sign-in"),
      primaryCta: {
        label: "Go to quickstart",
        href: "/docs/quickstart",
      },
      secondaryCta: {
        label: "Create workspace",
        href: "/sign-up",
      },
    },
    "sign-up": {
      slug: "sign-up",
      title: "Get started",
      summary: "Create your workspace and start serving maps immediately.",
      eyebrow: "New workspace",
      sections: buildAuthSections("sign-up"),
      primaryCta: {
        label: "Read the docs",
        href: "/docs/quickstart",
      },
      secondaryCta: {
        label: "Already have a workspace?",
        href: "/sign-in",
      },
    },
  };
}

export async function getMarketingPage(slug: MarketingPageSlug): Promise<MarketingPage> {
  const marketingPages = await buildMarketingPages();
  return clonePage(marketingPages[normalizeMarketingPageSlug(slug)]);
}
