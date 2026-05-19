import { describe, it, expect } from 'vitest';
import type { Moderation } from 'openai/resources/moderations.js';
import { classifyModerationResult, parseCategories, DEFAULT_AUTO_REMOVE_CATEGORIES } from './moderation';

function makeResult(overrides: Partial<Moderation.CategoryScores> = {}, flagged = false): Moderation {
  const scores: Moderation.CategoryScores = {
    sexual: 0,
    'sexual/minors': 0,
    harassment: 0,
    'harassment/threatening': 0,
    hate: 0,
    'hate/threatening': 0,
    illicit: 0,
    'illicit/violent': 0,
    'self-harm': 0,
    'self-harm/instructions': 0,
    'self-harm/intent': 0,
    violence: 0,
    'violence/graphic': 0,
    ...overrides,
  };
  return {
    flagged,
    categories: {} as Moderation.Categories,
    category_scores: scores,
    category_applied_input_types: {} as Moderation.CategoryAppliedInputTypes,
  };
}

describe('classifyModerationResult', () => {
  it('returns AUTO_REMOVE when a hard category exceeds the threshold', () => {
    const result = makeResult({ 'sexual/minors': 0.9 });
    const { tier, triggerCategory } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('AUTO_REMOVE');
    expect(triggerCategory).toBe('sexual/minors');
  });

  it('returns IGNORE when a hard category is below the threshold', () => {
    const result = makeResult({ 'sexual/minors': 0.5 });
    const { tier } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('IGNORE');
  });

  it('returns FLAG_FOR_REVIEW when flagged=true and highest score exceeds flag threshold', () => {
    const result = makeResult({ hate: 0.65 }, true);
    const { tier, triggerCategory } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('FLAG_FOR_REVIEW');
    expect(triggerCategory).toBe('hate');
  });

  it('returns IGNORE when flagged=false regardless of scores', () => {
    const result = makeResult({ hate: 0.65 }, false);
    const { tier } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('IGNORE');
  });

  it('returns IGNORE when flagged=true but highest score is below flag threshold', () => {
    const result = makeResult({ hate: 0.3 }, true);
    const { tier } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('IGNORE');
  });

  it('does not AUTO_REMOVE a hard category that is below threshold even if flagged', () => {
    const result = makeResult({ 'violence/graphic': 0.5, hate: 0.6 }, true);
    const { tier } = classifyModerationResult(result, 0.7, 0.5);
    expect(tier).toBe('FLAG_FOR_REVIEW');
  });

  it('respects custom autoRemoveCategories', () => {
    const customCats = new Set(['hate']);
    const result = makeResult({ hate: 0.8 });
    const { tier, triggerCategory } = classifyModerationResult(result, 0.7, 0.5, customCats);
    expect(tier).toBe('AUTO_REMOVE');
    expect(triggerCategory).toBe('hate');
  });

  it('does not auto-remove default hard categories when custom set overrides them', () => {
    const customCats = new Set(['hate']); // only hate triggers auto-remove
    const result = makeResult({ 'sexual/minors': 0.95 }, true);
    const { tier } = classifyModerationResult(result, 0.7, 0.5, customCats);
    // sexual/minors not in custom set → falls through to FLAG_FOR_REVIEW
    expect(tier).toBe('FLAG_FOR_REVIEW');
  });
});

describe('parseCategories', () => {
  it('returns fallback when input is empty', () => {
    expect(parseCategories('', DEFAULT_AUTO_REMOVE_CATEGORIES)).toBe(DEFAULT_AUTO_REMOVE_CATEGORIES);
    expect(parseCategories(undefined, DEFAULT_AUTO_REMOVE_CATEGORIES)).toBe(DEFAULT_AUTO_REMOVE_CATEGORIES);
  });

  it('parses a comma-separated string into a set', () => {
    const result = parseCategories('hate,violence/graphic', DEFAULT_AUTO_REMOVE_CATEGORIES);
    expect(result.has('hate')).toBe(true);
    expect(result.has('violence/graphic')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('trims whitespace around category names', () => {
    const result = parseCategories(' hate , violence/graphic ', DEFAULT_AUTO_REMOVE_CATEGORIES);
    expect(result.has('hate')).toBe(true);
    expect(result.has('violence/graphic')).toBe(true);
  });
});
