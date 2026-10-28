import {
  getCsrfSigningKey as getConfiguredCsrfSigningKey,
  getIpHashKey as getConfiguredIpHashKey,
} from "../../../config/security-secrets";

export function getCsrfSigningKey(): string {
  return getConfiguredCsrfSigningKey();
}

export function getIpHashKey(): string {
  return getConfiguredIpHashKey();
}
