import { vi, describe, it, expect, beforeEach } from 'vitest';

// Hoisted so they're available inside vi.mock factory
const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockRedis = {
    hSet: vi.fn().mockResolvedValue(undefined),
    hGetAll: vi.fn().mockResolvedValue({}),
    zAdd: vi.fn().mockResolvedValue(0),
    zRange: vi.fn().mockResolvedValue([]),
    mGet: vi.fn().mockResolvedValue(['0', '0', '0']),
    incrBy: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  };
  const mockSettings = { get: vi.fn() };
  const mockReddit = {
    getCommentById: vi.fn().mockResolvedValue({
      remove: vi.fn().mockResolvedValue(undefined),
      addRemovalNote: vi.fn().mockResolvedValue(undefined),
      approve: vi.fn().mockResolvedValue(undefined),
    }),
    addModNote: vi.fn().mockResolvedValue(undefined),
    modMail: { createModInboxConversation: vi.fn().mockResolvedValue(undefined) },
  };
  const mockContext = {
    subredditId: 't5_abc123' as `t5_${string}`,
    userId: 't2_mod123',
    subredditName: 'test_sub',
  };
  return { mockCreate, mockRedis, mockSettings, mockReddit, mockContext };
});

vi.mock('@devvit/web/server', () => ({
  settings: mocks.mockSettings,
  reddit: mocks.mockReddit,
  context: mocks.mockContext,
  redis: mocks.mockRedis,
  scheduler: { runJob: vi.fn() },
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return { moderations: { create: mocks.mockCreate } };
  }),
}));

import { triggers } from './triggers';

// Default moderation response: IGNORE (not flagged, all scores near zero)
const makeIgnoreResponse = () => ({
  results: [{
    flagged: false,
    categories: {},
    category_scores: {
      sexual: 0, 'sexual/minors': 0, harassment: 0, 'harassment/threatening': 0,
      hate: 0, 'hate/threatening': 0, illicit: 0, 'illicit/violent': 0,
      'self-harm': 0, 'self-harm/instructions': 0, 'self-harm/intent': 0,
      violence: 0, 'violence/graphic': 0,
    },
    category_applied_input_types: {},
  }],
});

// FLAG_FOR_REVIEW: flagged=true, hate score above flag threshold
const makeFlagResponse = () => ({
  results: [{
    flagged: true,
    categories: {},
    category_scores: {
      sexual: 0, 'sexual/minors': 0, harassment: 0, 'harassment/threatening': 0,
      hate: 0.65, 'hate/threatening': 0, illicit: 0, 'illicit/violent': 0,
      'self-harm': 0, 'self-harm/instructions': 0, 'self-harm/intent': 0,
      violence: 0, 'violence/graphic': 0,
    },
    category_applied_input_types: {},
  }],
});

// AUTO_REMOVE: sexual/minors above auto-remove threshold
const makeAutoRemoveResponse = () => ({
  results: [{
    flagged: true,
    categories: {},
    category_scores: {
      sexual: 0, 'sexual/minors': 0.9, harassment: 0, 'harassment/threatening': 0,
      hate: 0, 'hate/threatening': 0, illicit: 0, 'illicit/violent': 0,
      'self-harm': 0, 'self-harm/instructions': 0, 'self-harm/intent': 0,
      violence: 0, 'violence/graphic': 0,
    },
    category_applied_input_types: {},
  }],
});

const defaultSettings: Record<string, unknown> = {
  'open-ai-api-key': 'test-key',
  'auto-remove-threshold': 0.7,
  'flag-review-threshold': 0.5,
  'notify-modmail': true,
  'auto-remove-categories': '',
  'trusted-users': '',
  'dry-run-mode': false,
  'moderation-fail-mode': 'fail-open',
};

const commentPayload = {
  comment: {
    id: 't1_test123',
    body: 'test comment body',
    author: 'testuser',
    permalink: 'https://reddit.com/r/test_sub/comments/x/title/t1_test123',
  },
  subreddit: {
    id: 't5_abc123',
    name: 'test_sub',
  },
};

function makeRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('on-comment-create trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSettings.get.mockImplementation((key: string) =>
      Promise.resolve(defaultSettings[key] ?? null)
    );
    mocks.mockCreate.mockResolvedValue(makeIgnoreResponse());
  });

  it('returns 200 and ignores content when tier is IGNORE', async () => {
    mocks.mockCreate.mockResolvedValue(makeIgnoreResponse());

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockRedis.hSet).not.toHaveBeenCalled();
  });

  it('stores flagged item and increments pending when tier is FLAG_FOR_REVIEW', async () => {
    mocks.mockCreate.mockResolvedValue(makeFlagResponse());

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockRedis.hSet).toHaveBeenCalledWith(
      expect.stringContaining('t1_test123'),
      expect.objectContaining({ tier: 'FLAG_FOR_REVIEW', status: 'pending' }),
    );
    expect(mocks.mockRedis.incrBy).toHaveBeenCalledWith(
      expect.stringContaining('pending'),
      1,
    );
  });

  it('removes comment and stores as auto-removed when tier is AUTO_REMOVE', async () => {
    mocks.mockCreate.mockResolvedValue(makeAutoRemoveResponse());

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockReddit.getCommentById).toHaveBeenCalledWith('t1_test123');
    const { remove } = await mocks.mockReddit.getCommentById.mock.results[0]!.value;
    expect(remove).toHaveBeenCalled();
    expect(mocks.mockRedis.hSet).toHaveBeenCalledWith(
      expect.stringContaining('t1_test123'),
      expect.objectContaining({ status: 'auto-removed', tier: 'AUTO_REMOVE' }),
    );
  });

  it('skips OpenAI and returns 200 for a trusted user', async () => {
    mocks.mockSettings.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'trusted-users' ? 'testuser' : (defaultSettings[key] ?? null))
    );

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockCreate).not.toHaveBeenCalled();
    expect(mocks.mockRedis.hSet).not.toHaveBeenCalled();
  });

  it('stores api-error item when fail-closed and OpenAI throws', async () => {
    mocks.mockCreate.mockRejectedValue(Object.assign(new Error('Service unavailable'), { status: 503 }));
    mocks.mockSettings.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'moderation-fail-mode' ? 'fail-closed' : (defaultSettings[key] ?? null))
    );

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockRedis.hSet).toHaveBeenCalledWith(
      expect.stringContaining('t1_test123'),
      expect.objectContaining({ category: 'api-error', tier: 'FLAG_FOR_REVIEW' }),
    );
  });

  it('does NOT store anything when fail-open and OpenAI throws', async () => {
    mocks.mockCreate.mockRejectedValue(Object.assign(new Error('Service unavailable'), { status: 503 }));

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockRedis.hSet).not.toHaveBeenCalled();
  });

  it('stores as pending (not removed) in dry-run mode for AUTO_REMOVE', async () => {
    mocks.mockCreate.mockResolvedValue(makeAutoRemoveResponse());
    mocks.mockSettings.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'dry-run-mode' ? true : (defaultSettings[key] ?? null))
    );

    const res = await triggers.request(makeRequest('/on-comment-create', commentPayload));

    expect(res.status).toBe(200);
    expect(mocks.mockReddit.getCommentById).not.toHaveBeenCalled();
    expect(mocks.mockRedis.hSet).toHaveBeenCalledWith(
      expect.stringContaining('t1_test123'),
      expect.objectContaining({ status: 'pending', tier: 'AUTO_REMOVE' }),
    );
  });
});
