import type { Moderation } from 'openai/resources/moderations.js';

export type ModerationTier = 'AUTO_REMOVE' | 'FLAG_FOR_REVIEW' | 'IGNORE';

export type TierResult = {
  tier: ModerationTier;
  triggerCategory: string;
  score: number;
};

const AUTO_REMOVE_CATEGORIES: ReadonlySet<keyof Moderation.CategoryScores> = new Set([
  'sexual/minors',
  'hate/threatening',
  'violence/graphic',
  'self-harm/instructions',
  'self-harm/intent',
]);

export function classifyModerationResult(
  result: Moderation,
  autoRemoveThreshold: number,
  flagReviewThreshold: number,
): TierResult {
  for (const cat of AUTO_REMOVE_CATEGORIES) {
    const score = result.category_scores[cat] ?? 0;
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
