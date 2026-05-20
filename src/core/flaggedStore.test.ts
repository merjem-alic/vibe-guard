import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  hSet: vi.fn().mockResolvedValue(undefined),
  hGetAll: vi.fn().mockResolvedValue({}),
  zAdd: vi.fn().mockResolvedValue(0),
  zRange: vi.fn().mockResolvedValue([]),
  mGet: vi.fn().mockResolvedValue([null, null, null]),
  incrBy: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@devvit/web/server', () => ({ redis: mockRedis }));

import {
  storeFlaggedItem,
  updateFlaggedStatus,
  getFlaggedItem,
  getStats,
  incrementStat,
  adjustPendingCount,
  incrementAuthorViolations,
  KEYS,
  type FlaggedItem,
} from './flaggedStore';

const BASE_ITEM: FlaggedItem = {
  commentId: 't1_abc123',
  authorName: 'baduser',
  body: 'This is some toxic content',
  permalink: 'https://reddit.com/r/test/comments/abc/comment/t1_abc123',
  category: 'hate',
  score: '0.8500',
  tier: 'FLAG_FOR_REVIEW',
  status: 'pending',
  flaggedAt: '2026-05-20T09:00:00.000Z',
  contentType: 'comment',
};

describe('flaggedStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeFlaggedItem', () => {
    it('writes item hash and sorted-set entry', async () => {
      await storeFlaggedItem(BASE_ITEM);

      expect(mockRedis.hSet).toHaveBeenCalledWith(
        KEYS.flaggedItem('t1_abc123'),
        expect.objectContaining({ commentId: 't1_abc123', authorName: 'baduser', category: 'hate' }),
      );
      expect(mockRedis.zAdd).toHaveBeenCalledWith(
        KEYS.flaggedIndex,
        expect.objectContaining({ member: 't1_abc123' }),
      );
    });

    it('truncates body to 500 characters', async () => {
      await storeFlaggedItem({ ...BASE_ITEM, body: 'x'.repeat(600) });

      const written = (mockRedis.hSet as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
      expect(written['body']!.length).toBe(500);
    });

    it('defaults contentType to "comment" when undefined', async () => {
      const { contentType: _, ...withoutType } = BASE_ITEM;
      await storeFlaggedItem(withoutType as FlaggedItem);

      const written = (mockRedis.hSet as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
      expect(written['contentType']).toBe('comment');
    });

    it('stores "post" contentType for post items', async () => {
      await storeFlaggedItem({ ...BASE_ITEM, contentType: 'post' });

      const written = (mockRedis.hSet as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
      expect(written['contentType']).toBe('post');
    });
  });

  describe('updateFlaggedStatus', () => {
    it('writes only the status field', async () => {
      await updateFlaggedStatus('t1_abc123', 'restored');

      expect(mockRedis.hSet).toHaveBeenCalledOnce();
      expect(mockRedis.hSet).toHaveBeenCalledWith(KEYS.flaggedItem('t1_abc123'), { status: 'restored' });
    });
  });

  describe('getFlaggedItem', () => {
    it('returns undefined when hash is empty', async () => {
      mockRedis.hGetAll.mockResolvedValueOnce({});
      expect(await getFlaggedItem('t1_missing')).toBeUndefined();
    });

    it('returns the item when the hash has data', async () => {
      mockRedis.hGetAll.mockResolvedValueOnce({
        commentId: 't1_abc123',
        authorName: 'baduser',
        body: 'toxic content',
        permalink: 'https://reddit.com/...',
        category: 'hate',
        score: '0.8500',
        tier: 'FLAG_FOR_REVIEW',
        status: 'pending',
        flaggedAt: '2026-05-20T09:00:00.000Z',
        contentType: 'comment',
      });

      const item = await getFlaggedItem('t1_abc123');
      expect(item?.commentId).toBe('t1_abc123');
      expect(item?.status).toBe('pending');
    });
  });

  describe('getStats', () => {
    it('returns zeros when keys are not set', async () => {
      mockRedis.mGet.mockResolvedValueOnce([null, null, null]);
      expect(await getStats()).toEqual({ processed: 0, autoRemoved: 0, pending: 0 });
    });

    it('parses string values from Redis as integers', async () => {
      mockRedis.mGet.mockResolvedValueOnce(['42', '15', '7']);
      expect(await getStats()).toEqual({ processed: 42, autoRemoved: 15, pending: 7 });
    });
  });

  describe('incrementStat', () => {
    it('increments both total and daily keys for statsProcessed', async () => {
      await incrementStat('statsProcessed');

      expect(mockRedis.incrBy).toHaveBeenCalledTimes(2);
      expect(mockRedis.incrBy).toHaveBeenCalledWith(KEYS.statsProcessed, 1);
      // Second call is the daily key
      const [dailyKey] = (mockRedis.incrBy as ReturnType<typeof vi.fn>).mock.calls[1]!;
      expect(dailyKey).toMatch(/^vg:stats:processed:\d{4}-\d{2}-\d{2}$/);
    });

    it('increments only the total key for statsAutoRemoved', async () => {
      await incrementStat('statsAutoRemoved');

      expect(mockRedis.incrBy).toHaveBeenCalledOnce();
      expect(mockRedis.incrBy).toHaveBeenCalledWith(KEYS.statsAutoRemoved, 1);
    });
  });

  describe('adjustPendingCount', () => {
    it('calls incrBy with positive delta', async () => {
      await adjustPendingCount(1);
      expect(mockRedis.incrBy).toHaveBeenCalledWith(KEYS.statsPending, 1);
    });

    it('calls incrBy with negative delta to decrement', async () => {
      await adjustPendingCount(-1);
      expect(mockRedis.incrBy).toHaveBeenCalledWith(KEYS.statsPending, -1);
    });
  });

  describe('incrementAuthorViolations', () => {
    it('returns the new violation count from Redis', async () => {
      mockRedis.incrBy.mockResolvedValueOnce(3);

      const count = await incrementAuthorViolations('baduser');

      expect(count).toBe(3);
      expect(mockRedis.incrBy).toHaveBeenCalledWith(KEYS.authorViolations('baduser'), 1);
    });
  });
});
