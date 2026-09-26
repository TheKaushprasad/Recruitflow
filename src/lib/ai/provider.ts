// Which AI writes rubrics, rechecks and evidence. Safe to import from client components.

export type AiProvider = "claude" | "openai";

export const PROVIDER_LABEL: Record<AiProvider, string> = { claude: "Claude", openai: "OpenAI" };

/** Label for a stored `source` / `scored_by` value. */
export function providerLabel(value: string | null | undefined) {
  return value === "openai" ? "OpenAI" : value === "claude" ? "Claude" : "AI";
}

/**
 * AI_PROVIDER=openai|claude wins; otherwise whichever key is present
 * (Claude first, for backwards compatibility). Server-side only (reads env).
 */
export function activeProvider(): AiProvider | null {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  if (explicit === "openai" || explicit === "claude") return explicit;
  if (explicit === "anthropic") return "claude";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

/**
 * "screen" = stage 1 (every applicant, form answers). Can be a cheaper model via
 * OPENAI_SCREEN_MODEL / CLAUDE_SCREEN_MODEL; falls back to the main model.
 * "main" = rubric drafting and stage-2 deep evaluation.
 */
export function activeModel(p: AiProvider, purpose: "main" | "screen" = "main") {
  if (p === "openai") {
    const main = process.env.OPENAI_MODEL ?? "gpt-5";
    return purpose === "screen" ? process.env.OPENAI_SCREEN_MODEL || main : main;
  }
  const main = process.env.CLAUDE_MODEL ?? "claude-opus-5";
  return purpose === "screen" ? process.env.CLAUDE_SCREEN_MODEL || main : main;
}
