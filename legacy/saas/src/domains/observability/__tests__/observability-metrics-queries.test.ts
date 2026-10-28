import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("observability metrics SQL includes required aggregate queries", async (): Promise<void> => {
  const queryPath = resolve(process.cwd(), "src/domains/observability/analytics/metrics-queries.sql");
  const body = readFileSync(queryPath, "utf8");
  assert.equal(typeof body, "string");
  assert.equal(body.includes("cache_hit_ratio"), true);
  assert.equal(body.includes("endpoint_group"), true);
  assert.equal(body.includes("tile_delivery_events"), true);
  assert.equal(body.includes("approx_percentile"), true);
  assert.equal(body.includes("total_requests"), true);
});

