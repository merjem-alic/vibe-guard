import { Hono } from 'hono';
import type { OnCommentSubmitRequest, TriggerResponse } from '@devvit/web/shared';

export const triggers = new Hono();

// This is the specific "Ear" for new comments
triggers.post('/on-comment-create', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const comment = input.comment;
  const author = input.author;

  // This will print in your terminal when you run 'npm run dev'
  console.log(`[Vibe Check] New comment from u/${author?.name}: "${comment?.body}"`);

  return c.json<TriggerResponse>({ status: 'ok' });
});