import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnCommentSubmitRequest,
  OnPostSubmitRequest,
  OnCommentReportRequest,
  OnCommentDeleteRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { settings, reddit, scheduler, context } from '@devvit/web/server';
import OpenAI from 'openai';
import { classifyModerationResult, parseCategories, DEFAULT_AUTO_REMOVE_CATEGORIES } from '../core/moderation';
import {
  storeFlaggedItem,
  incrementStat,
  adjustPendingCount,
  setRemovalReasonId,
  getRemovalReasonId,
  getFlaggedItem,
  updateFlaggedStatus,
  incrementAuthorViolations,
  getDailyStats,
  getStats,
  getSchedulerLock,
  setSchedulerLock,
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

    // Schedule weekly digest (Monday 9am UTC) — Redis lock prevents duplicates on reinstall
    try {
      const alreadyScheduled = await getSchedulerLock();
      if (!alreadyScheduled) {
        await scheduler.runJob({ name: 'weekly-digest', cron: '0 9 * * 1' });
        await setSchedulerLock();
        console.log('[Vibe Guard] Weekly digest scheduled');
      } else {
        console.log('[Vibe Guard] Weekly digest already scheduled, skipping');
      }
    } catch (schedErr) {
      console.warn('[Vibe Guard] Could not schedule weekly digest:', schedErr);
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
    const [apiKey, autoRemoveThreshold, flagReviewThreshold, notifyModmail, autoRemoveCategoriesCsv, trustedUsersCsv, isDryRun] =
      await Promise.all([
        settings.get<string>('open-ai-api-key'),
        settings.get<number>('auto-remove-threshold'),
        settings.get<number>('flag-review-threshold'),
        settings.get<boolean>('notify-modmail'),
        settings.get<string>('auto-remove-categories'),
        settings.get<string>('trusted-users'),
        settings.get<boolean>('dry-run-mode'),
      ]);

    // Trusted user bypass
    const trustedUsers = new Set(
      (trustedUsersCsv ?? '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean),
    );
    if (trustedUsers.has(comment.author.toLowerCase())) {
      console.log(`[Vibe Guard] Skipping trusted user u/${comment.author}`);
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const resolvedApiKey = apiKey ?? process.env.OPEN_API_KEY;
    if (!resolvedApiKey) {
      console.error('[Vibe Guard] No OpenAI API key configured.');
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const autoRemoveCategories = parseCategories(autoRemoveCategoriesCsv, DEFAULT_AUTO_REMOVE_CATEGORIES);

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
      autoRemoveCategories,
    );

    console.log(
      `[Vibe Guard] Comment ${comment.id} → ${tier} (${triggerCategory} @ ${score.toFixed(3)})${isDryRun ? ' [DRY RUN]' : ''}`,
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
      status: tier === 'AUTO_REMOVE' && !isDryRun ? 'auto-removed' : 'pending',
      flaggedAt: new Date().toISOString(),
      contentType: 'comment',
    });

    // Repeat offender tracking
    const violationCount = await incrementAuthorViolations(authorName);
    const isRepeatOffender = violationCount >= 3;

    if (tier === 'AUTO_REMOVE') {
      if (!isDryRun) {
        const redditComment = await reddit.getCommentById(comment.id as `t1_${string}`);
        await redditComment.remove();
        await incrementStat('statsAutoRemoved');

        const reasonId = await getRemovalReasonId();
        if (reasonId) {
          await redditComment.addRemovalNote({
            reasonId,
            modNote: `Vibe Guard: ${triggerCategory} (${score.toFixed(2)})${isRepeatOffender ? ` [REPEAT OFFENDER ×${violationCount}]` : ''}`,
          });
        }

        if (subredditName) {
          await reddit.addModNote({
            subreddit: subredditName,
            user: authorName,
            note: `Vibe Guard auto-removed comment for ${triggerCategory} (score: ${score.toFixed(2)})${isRepeatOffender ? ` [violation #${violationCount}]` : ''}`,
            label: 'SPAM_WARNING',
            redditId: comment.id as `t1_${string}`,
          });
        }

        if (notifyModmail !== false && subredditId) {
          await sendModmail(subredditId, 'AUTO_REMOVE', authorName, comment.body, triggerCategory, score, permalink, violationCount);
        }
      } else {
        // Dry-run: store as pending so mods can review, no actual removal
        await adjustPendingCount(1);
        if (notifyModmail !== false && subredditId) {
          await sendModmail(subredditId, 'AUTO_REMOVE', authorName, comment.body, triggerCategory, score, permalink, violationCount, 'comment', true);
        }
      }
    } else {
      await adjustPendingCount(1);

      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'FLAG_FOR_REVIEW', authorName, comment.body, triggerCategory, score, permalink, violationCount);
      }
    }
  } catch (err) {
    console.error('[Vibe Guard] Error processing comment:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  const post = input.post;
  const subreddit = input.subreddit;

  if (!post?.id) {
    return c.json<TriggerResponse>({ status: 'ok' });
  }

  const textToScreen = [post.title, post.selftext].filter(Boolean).join('\n\n');
  if (!textToScreen.trim()) {
    return c.json<TriggerResponse>({ status: 'ok' });
  }

  console.log(`[Vibe Guard] Evaluating post ${post.id} by u/${input.author?.name}`);

  try {
    const [apiKey, autoRemoveThreshold, flagReviewThreshold, notifyModmail, autoRemoveCategoriesCsv, trustedUsersCsv, isDryRun] =
      await Promise.all([
        settings.get<string>('open-ai-api-key'),
        settings.get<number>('auto-remove-threshold'),
        settings.get<number>('flag-review-threshold'),
        settings.get<boolean>('notify-modmail'),
        settings.get<string>('auto-remove-categories'),
        settings.get<string>('trusted-users'),
        settings.get<boolean>('dry-run-mode'),
      ]);

    // Trusted user bypass
    const authorName = input.author?.name ?? 'unknown';
    const trustedUsers = new Set(
      (trustedUsersCsv ?? '').split(',').map((u) => u.trim().toLowerCase()).filter(Boolean),
    );
    if (trustedUsers.has(authorName.toLowerCase())) {
      console.log(`[Vibe Guard] Skipping trusted user u/${authorName}`);
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const resolvedApiKey = apiKey ?? process.env.OPEN_API_KEY;
    if (!resolvedApiKey) {
      console.error('[Vibe Guard] No OpenAI API key configured.');
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const autoRemoveCategories = parseCategories(autoRemoveCategoriesCsv, DEFAULT_AUTO_REMOVE_CATEGORIES);

    const openai = new OpenAI({ apiKey: resolvedApiKey });
    const moderation = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input: textToScreen,
    });

    const result = moderation.results[0];
    if (!result) return c.json<TriggerResponse>({ status: 'ok' });

    await incrementStat('statsProcessed');

    const { tier, triggerCategory, score } = classifyModerationResult(
      result,
      autoRemoveThreshold ?? 0.7,
      flagReviewThreshold ?? 0.5,
      autoRemoveCategories,
    );

    console.log(`[Vibe Guard] Post ${post.id} → ${tier} (${triggerCategory} @ ${score.toFixed(3)})${isDryRun ? ' [DRY RUN]' : ''}`);

    if (tier === 'IGNORE') return c.json<TriggerResponse>({ status: 'ok' });

    const subredditName = subreddit?.name ?? '';
    const subredditId = (subreddit?.id ?? '') as `t5_${string}`;
    const permalink = post.permalink;

    await storeFlaggedItem({
      commentId: post.id,
      authorName,
      body: textToScreen,
      permalink,
      category: triggerCategory,
      score: score.toFixed(4),
      tier,
      status: tier === 'AUTO_REMOVE' && !isDryRun ? 'auto-removed' : 'pending',
      flaggedAt: new Date().toISOString(),
      contentType: 'post',
    });

    const violationCount = await incrementAuthorViolations(authorName);
    const isRepeatOffender = violationCount >= 3;

    if (tier === 'AUTO_REMOVE') {
      if (!isDryRun) {
        const redditPost = await reddit.getPostById(post.id as `t3_${string}`);
        await redditPost.remove();
        await incrementStat('statsAutoRemoved');

        if (subredditName) {
          await reddit.addModNote({
            subreddit: subredditName,
            user: authorName,
            note: `Vibe Guard auto-removed a post for ${triggerCategory} (score: ${score.toFixed(2)})${isRepeatOffender ? ` [violation #${violationCount}]` : ''}`,
            label: 'SPAM_WARNING',
            redditId: post.id as `t3_${string}`,
          });
        }

        if (notifyModmail !== false && subredditId) {
          await sendModmail(subredditId, 'AUTO_REMOVE', authorName, textToScreen, triggerCategory, score, permalink, violationCount, 'post');
        }
      } else {
        // Dry-run: store as pending so mods can review, no actual removal
        await adjustPendingCount(1);
        if (notifyModmail !== false && subredditId) {
          await sendModmail(subredditId, 'AUTO_REMOVE', authorName, textToScreen, triggerCategory, score, permalink, violationCount, 'post', true);
        }
      }
    } else {
      await adjustPendingCount(1);

      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'FLAG_FOR_REVIEW', authorName, textToScreen, triggerCategory, score, permalink, violationCount, 'post');
      }
    }
  } catch (err) {
    console.error('[Vibe Guard] Error processing post:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

triggers.post('/on-comment-report', async (c) => {
  const input = await c.req.json<OnCommentReportRequest>();
  const comment = input.comment;
  const subreddit = input.subreddit;

  if (!comment?.body || !comment?.id) {
    return c.json<TriggerResponse>({ status: 'ok' });
  }

  console.log(`[Vibe Guard] Report received for comment ${comment.id}: "${input.reason}"`);

  try {
    // Skip if already auto-removed
    const existing = await getFlaggedItem(comment.id);
    if (existing?.status === 'auto-removed') {
      return c.json<TriggerResponse>({ status: 'ok' });
    }

    const [apiKey, autoRemoveThreshold, flagReviewThreshold, notifyModmail, autoRemoveCategoriesCsv] =
      await Promise.all([
        settings.get<string>('open-ai-api-key'),
        settings.get<number>('auto-remove-threshold'),
        settings.get<number>('flag-review-threshold'),
        settings.get<boolean>('notify-modmail'),
        settings.get<string>('auto-remove-categories'),
      ]);

    const resolvedApiKey = apiKey ?? process.env.OPEN_API_KEY;
    if (!resolvedApiKey) return c.json<TriggerResponse>({ status: 'ok' });

    const autoRemoveCategories = parseCategories(autoRemoveCategoriesCsv, DEFAULT_AUTO_REMOVE_CATEGORIES);

    const openai = new OpenAI({ apiKey: resolvedApiKey });
    const moderation = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input: comment.body,
    });

    const result = moderation.results[0];
    if (!result) return c.json<TriggerResponse>({ status: 'ok' });

    const { tier, triggerCategory, score } = classifyModerationResult(
      result,
      autoRemoveThreshold ?? 0.7,
      flagReviewThreshold ?? 0.5,
      autoRemoveCategories,
    );

    console.log(`[Vibe Guard] Re-screened reported comment ${comment.id} → ${tier}`);

    if (tier === 'IGNORE') return c.json<TriggerResponse>({ status: 'ok' });

    await incrementStat('statsProcessed');

    const subredditId = (subreddit?.id ?? '') as `t5_${string}`;
    const authorName = comment.author;
    const permalink = comment.permalink;

    if (!existing) {
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
        contentType: 'comment',
      });
    }

    if (tier === 'AUTO_REMOVE') {
      const redditComment = await reddit.getCommentById(comment.id as `t1_${string}`);
      await redditComment.remove();
      await incrementStat('statsAutoRemoved');

      if (existing?.status === 'pending') {
        await updateFlaggedStatus(comment.id, 'auto-removed');
        await adjustPendingCount(-1);
      }

      const subredditName = subreddit?.name ?? '';
      if (subredditName) {
        await reddit.addModNote({
          subreddit: subredditName,
          user: authorName,
          note: `Vibe Guard removed reported comment for ${triggerCategory} (score: ${score.toFixed(2)})`,
          label: 'SPAM_WARNING',
          redditId: comment.id as `t1_${string}`,
        });
      }

      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'AUTO_REMOVE', authorName, comment.body, triggerCategory, score, permalink, 0);
      }
    } else if (!existing) {
      await adjustPendingCount(1);
      if (notifyModmail !== false && subredditId) {
        await sendModmail(subredditId, 'FLAG_FOR_REVIEW', authorName, comment.body, triggerCategory, score, permalink, 0);
      }
    }
  } catch (err) {
    console.error('[Vibe Guard] Error processing report:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

triggers.post('/on-comment-delete', async (c) => {
  const input = await c.req.json<OnCommentDeleteRequest>();
  const commentId = input.commentId;

  if (!commentId) return c.json<TriggerResponse>({ status: 'ok' });

  console.log(`[Vibe Guard] Comment deleted: ${commentId}`);

  try {
    const existing = await getFlaggedItem(commentId);
    if (existing?.status === 'pending') {
      await updateFlaggedStatus(commentId, 'deleted');
      await adjustPendingCount(-1);
      console.log(`[Vibe Guard] Removed ${commentId} from pending queue (user deleted)`);
    }
  } catch (err) {
    console.error('[Vibe Guard] Error handling comment delete:', err);
  }

  return c.json<TriggerResponse>({ status: 'ok' });
});

triggers.post('/weekly-digest', async (c) => {
  console.log('[Vibe Guard] Weekly digest firing');

  try {
    const today = new Date();
    const lines: string[] = ['**Vibe Guard Weekly Digest**', ''];

    let totalThisWeek = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0]!;
      const count = await getDailyStats(dateKey);
      totalThisWeek += count;
      lines.push(`${dateKey}: ${count} items screened`);
    }

    const { autoRemoved, pending } = await getStats();

    lines.push('');
    lines.push(`**This week:** ${totalThisWeek} items screened`);
    lines.push(`**All-time auto-removed:** ${autoRemoved}`);
    lines.push(`**Currently pending review:** ${pending}`);

    const subredditId = context.subredditId;
    if (subredditId) {
      await reddit.modMail.createModInboxConversation({
        subject: '[Vibe Guard] Weekly Digest',
        bodyMarkdown: lines.join('\n'),
        subredditId,
      });
      console.log('[Vibe Guard] Weekly digest sent');
    } else {
      console.warn('[Vibe Guard] Weekly digest: no subreddit ID in context, skipping modmail');
    }
  } catch (err) {
    console.error('[Vibe Guard] Weekly digest error:', err);
  }

  return c.json({});
});

async function sendModmail(
  subredditId: `t5_${string}`,
  action: 'AUTO_REMOVE' | 'FLAG_FOR_REVIEW',
  authorName: string,
  body: string,
  category: string,
  score: number,
  permalink: string,
  violationCount: number,
  contentType: 'comment' | 'post' = 'comment',
  dryRun = false,
): Promise<void> {
  const contentLabel = contentType === 'post' ? 'Post' : 'Comment';
  const dryRunPrefix = dryRun ? '[DRY RUN] ' : '';
  const subject =
    action === 'AUTO_REMOVE'
      ? `${dryRunPrefix}[Vibe Guard] ${contentLabel} auto-removed`
      : `[Vibe Guard] ${contentLabel} flagged for review`;

  const repeatWarning = violationCount >= 3 ? `\n**Repeat offender:** violation #${violationCount}` : '';

  const bodyMarkdown = [
    `**Action:** ${action}`,
    `**Author:** u/${authorName}`,
    `**Category:** ${category}`,
    `**Confidence:** ${(score * 100).toFixed(1)}%`,
    repeatWarning,
    `**Permalink:**`,
    permalink,
    '',
    `**${contentLabel} text:**`,
    `> ${body.slice(0, 300).replace(/\n/g, '\n> ')}`,
  ].filter((line) => line !== '').join('\n');

  await reddit.modMail.createModInboxConversation({
    subject,
    bodyMarkdown,
    subredditId,
  });
}
