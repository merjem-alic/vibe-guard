import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { Devvit } from '@devvit/public-api';

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
  {
    name: 'dry-run-mode',
    label: 'Dry-Run Mode (log only, no removals)',
    type: 'boolean',
    scope: 'installation',
    defaultValue: false,
  },
  {
    name: 'trusted-users',
    label: 'Trusted Users (comma-separated, bypass screening)',
    type: 'string',
    scope: 'installation',
    defaultValue: '',
  },
]);


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
