import "server-only";

// TypeSafe Jev — System One structured decisions.
// HTTP API: POST https://api.typesafe.ai/v1/systemone  (docs.typesafe.ai/api)

const JEV_URL = process.env.TYPESAFE_API_URL ?? "https://api.typesafe.ai/v1/systemone";

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>; // option -> description
}

export interface JevAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  score?: number;
  noul?: number;
}

export class JevError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function jevDecide(
  state: unknown,
  questions: Record<string, JevChoiceQuestion>,
): Promise<Record<string, JevAnswer>> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError("TYPESAFE_API_KEY is not set", 401);

  // Retry 429/529 with exponential backoff, as the API docs recommend.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.JEV_MODEL ?? "jev-latest", state, questions }),
    });
    if (res.ok) {
      const body = (await res.json()) as { answers: Record<string, JevAnswer> };
      return body.answers;
    }
    if ((res.status === 429 || res.status === 529) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new JevError(`Jev request failed (${res.status}): ${detail.slice(0, 300)}`, res.status);
  }
}
