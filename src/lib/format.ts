export const nowMs = () => Date.now();

export function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function confLevel(v: number, threshold: number): ["High" | "Medium" | "Low", "good" | "warn" | "bad"] {
  return v >= 0.85 ? ["High", "good"] : v >= threshold ? ["Medium", "warn"] : ["Low", "bad"];
}

export const DECISION_LABEL: Record<string, [string, "good" | "warn" | "bad" | "neutral"]> = {
  meets: ["Meets", "good"],
  borderline: ["Borderline", "warn"],
  not_met: ["Doesn't meet", "bad"],
  pass: ["Passes", "good"],
  fail: ["Fails", "bad"],
  unclear: ["Unclear", "warn"],
};
