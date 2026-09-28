import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd } from "../src/lib/ai/pricing.ts";
import { MAX_ATTEMPTS, isPermanentError, retryDelayMs } from "../src/lib/retry.ts";
import { summarise } from "../src/lib/summary.ts";

test("cost uses fresh, cached and output prices", () => {
  // 3,000 in (1,000 cached) + 1,500 out on gpt-5.4-mini
  const c = costUsd("gpt-5.4-mini", { input: 3000, cached: 1000, output: 1500 })!;
  assert.equal(Math.round(c * 1e6), Math.round(2000 * 0.75 + 1000 * 0.075 + 1500 * 4.5));
});

test("dated model snapshots use the base price; unknown models have no price", () => {
  assert.equal(costUsd("gpt-5.4-mini-2026-03-05", { input: 1e6, cached: 0, output: 0 }), 0.75);
  assert.equal(costUsd("gpt-5.4-2026-03-05", { input: 1e6, cached: 0, output: 0 }), 2.5);
  assert.equal(costUsd("some-new-model", { input: 1e6, cached: 0, output: 0 }), null);
});

test("Jev bills input only", () => {
  assert.equal(costUsd("jev", { input: 1e6, cached: 0, output: 5000 }), 0.042);
});

test("retries back off and stop after the last attempt", () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(2), 5 * 60_000);
});

test("setup errors are not retried; transient ones are", () => {
  assert.ok(isPermanentError("OPENAI_API_KEY isn't set. Add it to your environment."));
  assert.ok(isPermanentError("401 Incorrect API key provided"));
  assert.ok(!isPermanentError("429 Rate limit reached for gpt-5.4-mini"));
  assert.ok(!isPermanentError("fetch failed: ETIMEDOUT"));
});

test("summary names strong, partial and weak items", () => {
  const f = (name: string, decision: string) => ({ criterion: { name }, decision: decision as never });
  assert.equal(
    summarise([f("React", "meets"), f("Notice", "pass"), f("Portfolio", "borderline"), f("Leadership", "not_met")]),
    "Strong on React, Notice; partly on Portfolio; falls short on Leadership.",
  );
  assert.equal(summarise([]), "Screened on the form answers.");
});

import { safeNext } from "../src/lib/next-path.ts";

test("sign-in return paths stay on this site", () => {
  assert.equal(safeNext("/jobs/abc?f=review"), "/jobs/abc?f=review");
  assert.equal(safeNext("//evil.com"), null);
  assert.equal(safeNext("https://evil.com"), null);
  assert.equal(safeNext("/\\evil.com"), null);
  assert.equal(safeNext(""), null);
  assert.equal(safeNext(null), null);
});
