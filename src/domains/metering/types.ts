export type UsageUnit = "request";

export type UsageCounterWindow = "minute" | "day" | "month";
export type MeteringEndpointGroup = "tiles" | "raster" | "static";

export type QuotaReason = "quota" | "rate_limit";

export interface QuotaDecision {
  readonly allow: boolean;
  readonly denyReason?: QuotaReason;
  readonly remaining?: number;
  readonly limit?: number;
}

export interface UsageSummary {
  readonly projectId: string;
  readonly keyHash: string;
  readonly planId: string;
  readonly window: UsageCounterWindow;
  readonly bucket: string;
  readonly endpointGroup: MeteringEndpointGroup;
  readonly requestCount: number;
  readonly unit: UsageUnit;
}

export interface BillingPlan {
  readonly planId: string;
  readonly freeAllowancePerMonth: number;
  readonly unitPricePerThousandRequests: number;
  readonly currency: string;
}

export interface BillingEstimate {
  readonly planId: string;
  readonly requestCount: number;
  readonly freeAllowance: number;
  readonly billedUnits: number;
  readonly unitPricePerThousand: number;
  readonly estimatedCost: number;
  readonly currency: string;
}

export interface UsageCounterRecord {
  readonly projectId: string;
  readonly keyHash: string;
  readonly endpointGroup: MeteringEndpointGroup;
  readonly window: UsageCounterWindow;
  readonly bucket: string;
  readonly count: number;
}
