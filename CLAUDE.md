# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start live playtest on the configured dev subreddit (`devvit playtest`)
- `npm run build` — Vite production build
- `npm run type-check` — TypeScript type checking (`tsc --build`)
- `npm run lint` — ESLint over `src/**/*.{ts,tsx}`
- `npm run test` — run Vitest tests once (no watch)
- `npm run deploy` — type-check + lint + test + `devvit upload`
- `npm run launch` — deploy then `devvit publish` (submits for Reddit app review)
- `npm run login` — authenticate the Devvit CLI with Reddit

## Architecture

This is a **Devvit web SDK** app — Reddit's platform for subreddit apps. The runtime is Node.js bundled via Vite with the `@devvit/start/vite` plugin. The server is a **Hono** HTTP app started with `@hono/node-server`, and Devvit's infrastructure calls it over HTTP.

### Entry point & route layout (`src/index.ts`)

```
app (Hono)
├── /api        → public-facing API routes (src/routes/api.ts)
└── /internal   → called by Devvit platform only
    ├── /menu   → context menu item handlers (src/routes/menu.ts)
    ├── /form   → form submission handlers (src/routes/forms.ts)
    └── /triggers → event trigger handlers (src/routes/triggers.ts)
```

Menu handlers return a `UiResponse` with `showForm` to open a native Reddit form. Form submit handlers receive the filled-in values and perform the actual action, returning `showToast`.

### Core logic (`src/core/nuke.ts`)

Bulk comment operations (remove/lock). Uses async generators to walk comment trees recursively (`getAllCommentsInThread`, `getAllCommentsInPost`). Always checks mod permissions via `user.getModPermissionsForSubreddit()` before acting.

### Triggers (`src/routes/triggers.ts`)

Event listeners fired by Devvit on subreddit activity. Currently listens for new comments at `POST /triggers/on-comment-create`. The payload type is `OnCommentSubmitRequest` from `@devvit/web/shared`.

### App settings

The OpenAI API key is registered as a **Devvit app setting** (not an environment variable) in `src/index.ts`:

```ts
Devvit.addSettings([
  { name: 'open-ai-api-key', type: 'string', isSecret: true, scope: 'app' },
]);
```

To read this setting at runtime, use the `settings` object from `@devvit/web/server` (via the request context), **not** `process.env`. Example:

```ts
import { context } from '@devvit/web/server';
const apiKey = await context.settings.get('open-ai-api-key');
```

The `openai` npm package is already installed — import `OpenAI` from `'openai'` and instantiate it with the retrieved key.

### Devvit type conventions

- `T1` = comment ID prefix, `T3` = post ID prefix, `T5` = subreddit ID prefix
- Use `isT1()` / `isT3()` from `@devvit/shared-types/tid.js` to validate IDs before passing them to Reddit API calls
- `reddit` and `context` utilities come from `@devvit/web/server`
