export const PLACEHOLDERS = ["first_name", "full_name", "job_title", "stage", "status", "recruiter_name"] as const;

export type PlaceholderValues = Record<(typeof PLACEHOLDERS)[number], string>;

export function fillTemplate(text: string, values: Partial<PlaceholderValues>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k as keyof PlaceholderValues] ?? m);
}

export function unfilled(text: string) {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
}
