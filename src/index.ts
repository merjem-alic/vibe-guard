import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { Devvit } from '@devvit/public-api';
import { KEYS } from './core/flaggedStore';

Devvit.addSettings([
  {
    name: 'open-ai-api-key',
    label: 'OpenAI API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
  {
    name: 'auto-remove-threshold',
    label: 'Auto-Remove Score Threshold (0–1)',
    type: 'number',
    scope: 'installation',
    defaultValue: 0.7,
  },
  {
    name: 'flag-review-threshold',
    label: 'Flag-for-Review Score Threshold (0–1)',
    type: 'number',
    scope: 'installation',
    defaultValue: 0.5,
  },
  {
    name: 'notify-modmail',
    label: 'Send Modmail Notifications',
    type: 'boolean',
    scope: 'installation',
    defaultValue: true,
  },
  {
    name: 'auto-remove-categories',
    label: 'Auto-Remove Categories (comma-separated)',
    type: 'string',
    scope: 'installation',
    defaultValue: 'sexual/minors,hate/threatening,violence/graphic,self-harm/instructions,self-harm/intent',
  },
]);

Devvit.addSchedulerJob({
  name: 'weekly-digest',
  onRun: async (_event, context) => {
    const today = new Date();
    const lines: string[] = ['**Vibe Guard Weekly Digest**', ''];

    let totalThisWeek = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().split('T')[0]!;
      const val = await context.redis.get(KEYS.statsDailyProcessed(dateKey));
      const count = val ? parseInt(val, 10) : 0;
      totalThisWeek += count;
      lines.push(`${dateKey}: ${count} comments processed`);
    }

    const autoRemovedStr = await context.redis.get(KEYS.statsAutoRemoved);
    const pendingStr = await context.redis.get(KEYS.statsPending);

    lines.push('');
    lines.push(`**This week:** ${totalThisWeek} comments screened`);
    lines.push(`**All-time auto-removed:** ${autoRemovedStr ?? '0'}`);
    lines.push(`**Currently pending review:** ${pendingStr ?? '0'}`);

    const subredditId = context.subredditId;
    if (subredditId) {
      await context.reddit.modMail.createModInboxConversation({
        subject: '[Vibe Guard] Weekly Digest',
        bodyMarkdown: lines.join('\n'),
        subredditId,
      });
      console.log('[Vibe Guard] Weekly digest sent');
    }
  },
});

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
