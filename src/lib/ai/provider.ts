// The AI behind rubric drafting, stage-1 checks and stage-2 reviews: OpenAI.
// Safe to import from client components.

/** Stored values on older records may still say "claude". */
export type AiProvider = "openai" | "claude";

export const PROVIDER_LABEL: Record<AiProvider, string> = { openai: "OpenAI", claude: "Claude" };

/** Label for a stored `source` / `scored_by` value. */
export function providerLabel(value: string | null | undefined) {
  return value === "openai" ? "OpenAI" : value === "claude" ? "Claude" : "AI";
}

/** "openai" when an OpenAI key is configured, else null. Server-side only (reads env). */
export function activeProvider(): "openai" | null {
  return process.env.OPENAI_API_KEY ? "openai" : null;
}

/**
 * "screen" = stage 1 (every applicant, form answers); can be a cheaper model via OPENAI_SCREEN_MODEL.
 * "main" = rubric drafting and stage-2 deep evaluation.
 */
export function activeModel(purpose: "main" | "screen" = "main") {
  const main = process.env.OPENAI_MODEL ?? "gpt-5.5";
  return purpose === "screen" ? process.env.OPENAI_SCREEN_MODEL || main : main;
}
