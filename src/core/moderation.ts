import type { Moderation } from 'openai/resources/moderations.js';

export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      // Non-transient client errors: bail immediately
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export type ModerationTier = 'AUTO_REMOVE' | 'FLAG_FOR_REVIEW' | 'IGNORE';

export type TierResult = {
  tier: ModerationTier;
  triggerCategory: string;
  score: number;
};

export const DEFAULT_AUTO_REMOVE_CATEGORIES: ReadonlySet<string> = new Set([
  'sexual/minors',
  'hate/threatening',
  'violence/graphic',
  'self-harm/instructions',
  'self-harm/intent',
]);

export function parseCategories(csv: string | undefined, fallback: ReadonlySet<string>): ReadonlySet<string> {
  if (!csv?.trim()) return fallback;
  return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
}

export function classifyModerationResult(
  result: Moderation,
  autoRemoveThreshold: number,
  flagReviewThreshold: number,
  autoRemoveCategories: ReadonlySet<string> = DEFAULT_AUTO_REMOVE_CATEGORIES,
): TierResult {
  for (const cat of autoRemoveCategories) {
    const score = (result.category_scores as unknown as Record<string, number>)[cat] ?? 0;
    if (score > autoRemoveThreshold) {
      return { tier: 'AUTO_REMOVE', triggerCategory: cat, score };
    }
  }

  if (!result.flagged) {
    return { tier: 'IGNORE', triggerCategory: '', score: 0 };
  }

  let highestScore = 0;
  let highestCat = '';
  for (const [cat, score] of Object.entries(result.category_scores) as [string, number][]) {
    if (score > highestScore) {
      highestScore = score;
      highestCat = cat;
    }
  }

  if (highestScore > flagReviewThreshold) {
    return { tier: 'FLAG_FOR_REVIEW', triggerCategory: highestCat, score: highestScore };
  }

  return { tier: 'IGNORE', triggerCategory: '', score: 0 };
}
