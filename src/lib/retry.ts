/** Automatic retries for background AI work: 3 attempts, 1 then 5 minutes apart. */
export const MAX_ATTEMPTS = 3;
const DELAYS_MIN = [1, 5, 15];

export function retryDelayMs(attempt: number) {
  return DELAYS_MIN[Math.min(attempt, DELAYS_MIN.length) - 1] * 60_000;
}

/** A failure that won't fix itself by waiting (bad setup or bad input): don't retry. */
export class PermanentError extends Error {}

export function isPermanentError(message: string) {
  return /isn't set|Missing environment variable|invalid_api_key|Incorrect API key|\b401\b|no enabled filters|declined this request/i.test(message);
}
