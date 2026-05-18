import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, settings, reddit } from '@devvit/web/server';
import { isT1, isT3 } from '@devvit/shared-types/tid.js';
import { handleNuke, handleNukePost } from '../core/nuke';
import {
  getStats,
  getRecentFlaggedItems,
  updateFlaggedStatus,
  adjustPendingCount,
} from '../core/flaggedStore';

type NukeFormValues = {
  remove?: boolean;
  lock?: boolean;
  skipDistinguished?: boolean;
  targetId?: string;
};

export const forms = new Hono();

const normalizeValues = (values: NukeFormValues) => ({
  remove: Boolean(values.remove),
  lock: Boolean(values.lock),
  skipDistinguished: Boolean(values.skipDistinguished),
});

const getTargetId = (values: NukeFormValues) => {
  if (typeof values.targetId === 'string' && values.targetId.trim()) {
    return values.targetId.trim();
  }

  return context.postId;
};

forms.post('/mop-comment-submit', async (c) => {
  const values = await c.req.json<NukeFormValues>();
  console.log('values', values);
  const normalized = normalizeValues(values);

  if (!normalized.lock && !normalized.remove) {
    return c.json<UiResponse>(
      {
        showToast: 'You must select either lock or remove.',
      },
      200
    );
  }

  const targetId = getTargetId(values);
  if (!isT1(targetId)) {
    console.error('targetId is not a T1', targetId);
    return c.json<UiResponse>(
      {
        showToast: 'Mop failed! Please try again later.',
      },
      200
    );
  }

  const result = await handleNuke({
    ...normalized,
    commentId: targetId,
    subredditId: context.subredditId,
  });

  console.log(
    `Mop result - ${result.success ? 'success' : 'fail'} - ${result.message}`
  );

  return c.json<UiResponse>(
    {
      showToast: `${result.success ? 'Success' : 'Failed'} : ${result.message}`,
    },
    200
  );
});

forms.post('/mop-post-submit', async (c) => {
  const values = await c.req.json<NukeFormValues>();
  console.log('values', values);
  const normalized = normalizeValues(values);

  if (!normalized.lock && !normalized.remove) {
    return c.json<UiResponse>(
      {
        showToast: 'You must select either lock or remove.',
      },
      200
    );
  }

  const targetId = getTargetId(values);
  if (!isT3(targetId)) {
    console.error('targetId is not a T3', targetId);
    return c.json<UiResponse>(
      {
        showToast: 'Mop failed! Please try again later.',
      },
      200
    );
  }

  const result = await handleNukePost({
    ...normalized,
    postId: targetId,
    subredditId: context.subredditId,
  });

  console.log(
    `Mop result - ${result.success ? 'success' : 'fail'} - ${result.message}`
  );

  return c.json<UiResponse>(
    {
      showToast: `${result.success ? 'Success' : 'Failed'} : ${result.message}`,
    },
    200
  );
});

forms.post('/vg-review-queue-submit', async (c) => {
  try {
    const [stats, recentItems] = await Promise.all([getStats(), getRecentFlaggedItems(5)]);

    const itemLines =
      recentItems.length === 0
        ? ['No flagged items found.']
        : recentItems.map((item, i) =>
            [
              `${i + 1}. u/${item.authorName} — ${item.category} (${(parseFloat(item.score) * 100).toFixed(0)}%)`,
              `   Status: ${item.status} | Tier: ${item.tier}`,
              `   "${item.body.slice(0, 80)}..."`,
              `   ${item.permalink}`,
            ].join('\n'),
          );

    const queueText = [
      `Processed: ${stats.processed} | Auto-removed: ${stats.autoRemoved} | Pending: ${stats.pending}`,
      '',
      'Last 5 flagged items:',
      ...itemLines,
    ].join('\n');

    return c.json<UiResponse>({
      showForm: {
        name: 'vgReviewQueue',
        form: {
          title: 'Vibe Guard: Review Queue',
          fields: [
            {
              name: 'queueDisplay',
              label: 'Queue Summary',
              type: 'paragraph',
              defaultValue: queueText,
            },
          ],
          acceptLabel: 'Refresh',
          cancelLabel: 'Close',
        },
      },
    });
  } catch (err) {
    console.error('[Vibe Guard] Review queue error:', err);
    return c.json<UiResponse>({ showToast: 'Failed to load review queue.' });
  }
});

forms.post('/vg-settings-submit', async (c) => {
  try {
    const [autoThreshold, flagThreshold, notifyMail] = await Promise.all([
      settings.get<number>('auto-remove-threshold'),
      settings.get<number>('flag-review-threshold'),
      settings.get<boolean>('notify-modmail'),
    ]);

    const settingsText = [
      `Auto-Remove Threshold: ${autoThreshold ?? 0.7}`,
      `Flag-for-Review Threshold: ${flagThreshold ?? 0.5}`,
      `Modmail Notifications: ${notifyMail !== false ? 'Enabled' : 'Disabled'}`,
      '',
      'Change these in the subreddit app settings panel.',
    ].join('\n');

    return c.json<UiResponse>({
      showForm: {
        name: 'vgSettings',
        form: {
          title: 'Vibe Guard: Settings',
          fields: [
            {
              name: 'settingsDisplay',
              label: 'Current Configuration',
              type: 'paragraph',
              defaultValue: settingsText,
            },
          ],
          acceptLabel: 'OK',
          cancelLabel: 'Close',
        },
      },
    });
  } catch (err) {
    console.error('[Vibe Guard] Settings display error:', err);
    return c.json<UiResponse>({ showToast: 'Failed to load settings.' });
  }
});

forms.post('/vg-restore-comment-submit', async (c) => {
  const values = await c.req.json<{ commentId?: string }>();
  const commentId = values.commentId?.trim();

  if (!commentId || !isT1(commentId)) {
    return c.json<UiResponse>({ showToast: 'Invalid comment ID.' });
  }

  try {
    const redditComment = await reddit.getCommentById(commentId as `t1_${string}`);
    await redditComment.approve();
    await updateFlaggedStatus(commentId, 'restored');
    await adjustPendingCount(-1);

    console.log(`[Vibe Guard] Comment ${commentId} restored by mod u/${context.userId}`);
    return c.json<UiResponse>({ showToast: 'Comment restored successfully.' });
  } catch (err) {
    console.error('[Vibe Guard] Restore comment error:', err);
    return c.json<UiResponse>({ showToast: 'Failed to restore comment. Please try again.' });
  }
});
