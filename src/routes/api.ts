import { Hono } from 'hono';
import { getStats, getRecentFlaggedItems } from '../core/flaggedStore';

export const api = new Hono();

api.get('/debug/stats', async (c) => {
  const [stats, recentItems] = await Promise.all([getStats(), getRecentFlaggedItems(10)]);
  return c.json({ stats, recentItems });
});
