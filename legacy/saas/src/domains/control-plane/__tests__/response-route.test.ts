import { strict as assert } from "node:assert";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminErrorResponse, unauthorizedAdminResponse } from "../routes/response";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("adminErrorResponse maps control-plane errors by code", (): void => {
  const response = adminErrorResponse(
    new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "invalid payload"),
    {
      defaultStatus: 503,
      defaultMessage: "fallback",
    },
  );
  assert.equal(response.status, 400);
  assert.equal((response.body as { code?: string }).code, ControlPlaneErrorCode.BAD_REQUEST);
  assert.equal((response.body as { error?: string }).error, "invalid payload");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("adminErrorResponse uses default message for unknown errors", (): void => {
  const response = adminErrorResponse(new Error("unexpected secret"), {
    defaultStatus: 503,
    defaultMessage: "Operation failed",
  });
  assert.equal(response.status, 503);
  assert.equal((response.body as { error?: string }).error, "Operation failed");
  assert.equal(response.headers["content-type"], "application/json");
});

test("unauthorizedAdminResponse returns 401 JSON contract", (): void => {
  const response = unauthorizedAdminResponse();
  assert.equal(response.status, 401);
  assert.equal((response.body as { error?: string }).error, "Unauthorized");
  assert.equal(response.headers["cache-control"], "no-store");
});
