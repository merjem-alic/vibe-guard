import { redis } from '@devvit/web/server';

export const KEYS = {
  removalReasonId: 'vg:config:removal-reason-id',
  schedulerLock: 'vg:config:digest-scheduled',
  statsProcessed: 'vg:stats:total-processed',
  statsAutoRemoved: 'vg:stats:auto-removed',
  statsPending: 'vg:stats:pending-review',
  flaggedIndex: 'vg:flagged:index',
  flaggedItem: (id: string) => `vg:flagged:item:${id}`,
  authorViolations: (name: string) => `vg:user-violations:${name}`,
  statsDailyProcessed: (date: string) => `vg:stats:processed:${date}`,
} as const;

export type FlaggedItemStatus = 'pending' | 'auto-removed' | 'restored' | 'confirmed' | 'deleted' | 'dismissed';

export type FlaggedItem = {
  commentId: string;
  authorName: string;
  body: string;
  permalink: string;
  category: string;
  score: string;
  tier: string;
  status: FlaggedItemStatus;
  flaggedAt: string;
  contentType?: 'comment' | 'post';
};

export async function storeFlaggedItem(item: FlaggedItem): Promise<void> {
  const now = Date.now();
  await Promise.all([
    redis.hSet(KEYS.flaggedItem(item.commentId), {
      commentId: item.commentId,
      authorName: item.authorName,
      body: item.body.slice(0, 500),
      permalink: item.permalink,
      category: item.category,
      score: item.score,
      tier: item.tier,
      status: item.status,
      flaggedAt: item.flaggedAt,
      contentType: item.contentType ?? 'comment',
    }),
    redis.zAdd(KEYS.flaggedIndex, { member: item.commentId, score: now }),
  ]);
}

export async function updateFlaggedStatus(
  id: string,
  status: FlaggedItemStatus,
): Promise<void> {
  await redis.hSet(KEYS.flaggedItem(id), { status });
}

export async function getFlaggedItem(id: string): Promise<FlaggedItem | undefined> {
  const data = await redis.hGetAll(KEYS.flaggedItem(id));
  if (!data || !data['commentId']) return undefined;
  return data as unknown as FlaggedItem;
}

export async function getRecentFlaggedItems(limit: number): Promise<FlaggedItem[]> {
  const members = await redis.zRange(KEYS.flaggedIndex, 0, limit - 1, {
    by: 'rank',
    reverse: true,
  });
  const items = await Promise.all(members.map(({ member }) => getFlaggedItem(member)));
  return items.filter((item): item is FlaggedItem => item !== undefined);
}

export async function getStats(): Promise<{
  processed: number;
  autoRemoved: number;
  pending: number;
}> {
  const [p, a, pnd] = await redis.mGet([
    KEYS.statsProcessed,
    KEYS.statsAutoRemoved,
    KEYS.statsPending,
  ]);
  return {
    processed: p ? parseInt(p, 10) : 0,
    autoRemoved: a ? parseInt(a, 10) : 0,
    pending: pnd ? parseInt(pnd, 10) : 0,
  };
}

export async function incrementStat(key: 'statsProcessed' | 'statsAutoRemoved'): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;
  if (key === 'statsProcessed') {
    await Promise.all([
      redis.incrBy(KEYS[key], 1),
      redis.incrBy(KEYS.statsDailyProcessed(today), 1),
    ]);
  } else {
    await redis.incrBy(KEYS[key], 1);
  }
}

export async function adjustPendingCount(delta: number): Promise<void> {
  await redis.incrBy(KEYS.statsPending, delta);
}

export async function setRemovalReasonId(id: string): Promise<void> {
  await redis.set(KEYS.removalReasonId, id);
}

export async function getRemovalReasonId(): Promise<string | undefined> {
  return (await redis.get(KEYS.removalReasonId)) ?? undefined;
}

export async function getDailyStats(date: string): Promise<number> {
  const val = await redis.get(KEYS.statsDailyProcessed(date));
  return val ? parseInt(val, 10) : 0;
}

export async function incrementAuthorViolations(authorName: string): Promise<number> {
  return redis.incrBy(KEYS.authorViolations(authorName), 1);
}

export async function getAuthorViolationCount(authorName: string): Promise<number> {
  const val = await redis.get(KEYS.authorViolations(authorName));
  return val ? parseInt(val, 10) : 0;
}

export async function getSchedulerLock(): Promise<boolean> {
  const val = await redis.get(KEYS.schedulerLock);
  return val === '1';
}

export async function setSchedulerLock(): Promise<void> {
  await redis.set(KEYS.schedulerLock, '1');
}
