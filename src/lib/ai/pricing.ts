/**
 * USD per 1M tokens (standard tier). Keep in sync with https://developers.openai.com/api/docs/pricing
 * and TypeSafe's Jev pricing. Unknown models are logged with a null cost rather than a guess.
 */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.5": { input: 5, cached: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cached: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cached: 0.075, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, cached: 0.02, output: 1.25 },
  "gpt-5.2": { input: 1.75, cached: 0.175, output: 14 },
  "gpt-5.1": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cached: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cached: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cached: 0.005, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, cached: 0.1, output: 1.6 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
  jev: { input: 0.042, cached: 0.042, output: 0 },
};

/** Price for a model id, tolerating dated snapshots like "gpt-5.4-mini-2026-03-05". */
function priceFor(model: string) {
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? PRICES[base] : null;
}

export function costUsd(model: string, t: { input: number; cached: number; output: number }): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const fresh = Math.max(0, t.input - t.cached);
  return (fresh * p.input + t.cached * p.cached + t.output * p.output) / 1e6;
}
