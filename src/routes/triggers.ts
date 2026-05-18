import { Hono } from 'hono';
import type { OnAppInstallRequest, OnCommentSubmitRequest, TriggerResponse } from '@devvit/web/shared';
import { settings, reddit } from '@devvit/web/server';
import OpenAI from 'openai';
import { classifyModerationResult } from '../core/moderation';
import {
  storeFlaggedItem,
  incrementStat,
  adjustPendingCount,
  setRemovalReasonId,
  getRemovalReasonId,
} from '../core/flaggedStore';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  const subredditName = input.subreddit?.name;

  console.log(`[Vibe Guard] App installed on r/${subredditName}`);

  if (!subredditName) {
    return c.json<TriggerResponse>({ status: 'ok' });
  }

  try {
    const existing = await getRemovalReasonId();
    if (!existing) {
      const reasonId = await reddit.addSubredditRemovalReason(subredditName, {
        title: 'Removed by Vibe Guard',
        message: 'This comment was automatically removed by Vibe Guard AI moderation.',
      });
      await setRemovalReasonId(reasonId);
      console.log(`[Vibe Guard] Created removal reason: ${reasonId}`);
    } else {
      console.log(`[Vibe Guard] Removal reason already exists: ${existing}`);
    }
  } catch (err) {
    console.error('[Vibe Guard] Failed during app install setup:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

triggers.post('/on-comment-create', async (c) => {
  const input = await c.req.json<OnCommentSubmitRequest>();
  const comment = input.comment;
  const subreddit = input.subreddit;

  if (!comment?.body || !comment?.id) {
    return c.json<TriggerResponse>({ status: 'ok' });
  }

  console.log(`[Vibe Guard] Evaluating comment ${comment.id} from u/${comment.author}`);

  try {
    const [apiKey, autoRemoveThreshold, flagReviewThreshold, notifyModmail] = await Promise.all([
      settings.get<string>('open-ai-api-key'),
      settings.get<number>('auto-remove-threshold'),
      settings.get<number>('flag-review-threshold'),
      settings.get<boolean>('notify-modmail'),
    ]);

    const resolvedApiKey = apiKey ?? process.env.OPEN_API_KEY;
    if (!resolvedApiKey) {
      console.error('[Vibe Guard] No OpenAI API key configured.');
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const openai = new OpenAI({ apiKey: resolvedApiKey });
    const moderation = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input: comment.body,
    });

    const result = moderation.results[0];
    if (!result) {
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    await incrementStat('statsProcessed');

    const { tier, triggerCategory, score } = classifyModerationResult(
      result,
      autoRemoveThreshold ?? 0.7,
      flagReviewThreshold ?? 0.5,
    );

    console.log(
      `[Vibe Guard] Comment ${comment.id} → ${tier} (${triggerCategory} @ ${score.toFixed(3)})`,
    );

    if (tier === 'IGNORE') {
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const subredditName = subreddit?.name ?? '';
    const subredditId = (subreddit?.id ?? '') as `t5_${string}`;
    const authorName = comment.author;
    const permalink = comment.permalink;

    await storeFlaggedItem({
      commentId: comment.id,
      authorName,
      body: comment.body,
      permalink,
      category: triggerCategory,
      score: score.toFixed(4),
      tier,
      status: tier === 'AUTO_REMOVE' ? 'auto-removed' : 'pending',
      flaggedAt: new Date().toISOString(),
    });

    if (tier === 'AUTO_REMOVE') {
      const redditComment = await reddit.getCommentById(comment.id as `t1_${string}`);
      await redditComment.remove();
      await incrementStat('statsAutoRemoved');

      const reasonId = await getRemovalReasonId();
      if (reasonId) {
        await redditComment.addRemovalNote({
          reasonId,
          modNote: `Vibe Guard: ${triggerCategory} (${score.toFixed(2)})`,
        });
      }

      if (subredditName) {
        await reddit.addModNote({
          subreddit: subredditName,
          user: authorName,
          note: `Vibe Guard auto-removed a comment for ${triggerCategory} (score: ${score.toFixed(2)})`,
          label: 'SPAM_WARNING',
          redditId: comment.id as `t1_${string}`,
        });
      }

      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'AUTO_REMOVE', authorName, comment.body, triggerCategory, score, permalink);
      }
    } else {
      await adjustPendingCount(1);

      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'FLAG_FOR_REVIEW', authorName, comment.body, triggerCategory, score, permalink);
      }
    }
  } catch (err) {
    console.error('[Vibe Guard] Error processing comment:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

async function sendModmail(
  subredditId: `t5_${string}`,
  action: 'AUTO_REMOVE' | 'FLAG_FOR_REVIEW',
  authorName: string,
  body: string,
  category: string,
  score: number,
  permalink: string,
): Promise<void> {
  const subject =
    action === 'AUTO_REMOVE'
      ? '[Vibe Guard] Comment auto-removed'
      : '[Vibe Guard] Comment flagged for review';

  const bodyMarkdown = [
    `**Action:** ${action}`,
    `**Author:** u/${authorName}`,
    `**Category:** ${category}`,
    `**Confidence:** ${(score * 100).toFixed(1)}%`,
    `**Permalink:** ${permalink}`,
    '',
    '**Comment text:**',
    `> ${body.slice(0, 300).replace(/\n/g, '\n> ')}`,
  ].join('\n');

  await reddit.modMail.createModInboxConversation({
    subject,
    bodyMarkdown,
    subredditId,
  });
}
