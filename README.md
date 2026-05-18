# Vibe Guard

An AI-powered Reddit moderation tool built with [Devvit](https://developers.reddit.com/), [Hono](https://hono.dev/), and [OpenAI](https://platform.openai.com/docs/guides/moderation). Vibe Guard automatically screens comments for toxic content and gives moderators a full review workflow — all inside Reddit's native UI.

## Features

### Automatic AI Moderation
- Every new comment is evaluated by OpenAI's `omni-moderation-latest` model in real time
- **Tiered response system** based on category confidence scores:
  - **Auto-Remove** (score > 0.7): `sexual/minors`, `hate/threatening`, `violence/graphic`, `self-harm/instructions`, `self-harm/intent` — removed instantly
  - **Flag for Review** (score > 0.5): all other flagged categories — comment stays up, mods alerted
  - **Ignore**: everything below threshold — no action taken
- Removed comments automatically receive a subreddit removal reason and a mod note on the author's account
- Modmail notification sent to the mod team for every auto-removal and flag, including the comment text, category, and confidence score

### Manual Moderation Tools
- **Mop comment** — remove and/or lock a comment and all its replies in one click
- **Mop post** — remove and/or lock every comment on a post at once
- **Restore comment** — approve a Vibe Guard–removed comment directly from the comment context menu

### Mod Dashboard (native Reddit UI)
- **Review Queue** — accessible from any post; shows total processed / auto-removed / pending counts and the last 5 flagged items with full context
- **Settings** — view current threshold configuration without leaving Reddit

### Persistence & Auditability
- All flagged items stored in Redis with full metadata: author, comment body, category, confidence score, tier, status, permalink, and timestamp
- Status lifecycle tracked: `pending` → `auto-removed` → `restored` / `confirmed`
- Running counters for processed, auto-removed, and pending items

## Tech Stack

| Layer | Technology |
|---|---|
| Platform | [Devvit](https://developers.reddit.com/) 0.12.x |
| Server | [Hono](https://hono.dev/) + `@hono/node-server` |
| Build | [Vite](https://vite.dev/) with `@devvit/start/vite` |
| AI | [OpenAI](https://platform.openai.com/) Moderation API |
| Storage | Devvit Redis (`@devvit/redis`) |
| Language | TypeScript (strict mode) |

## Project Structure

```
src/
├── index.ts              # Server entry — Hono app, Devvit settings registration
├── core/
│   ├── moderation.ts     # Pure classification logic (AUTO_REMOVE / FLAG_FOR_REVIEW / IGNORE)
│   ├── flaggedStore.ts   # Redis persistence layer — flagged items, counters, config
│   └── nuke.ts           # Bulk comment remove/lock operations
└── routes/
    ├── triggers.ts       # Event handlers: onAppInstall, onCommentSubmit
    ├── menu.ts           # Context menu item handlers
    ├── forms.ts          # Form submission handlers
    └── api.ts            # Public API endpoints
```

## Getting Started

### Prerequisites
- Node.js >= 22.2.0
- A Reddit account with moderator access to a test subreddit
- An [OpenAI API key](https://platform.openai.com/api-keys)
- Devvit CLI: `npm install -g devvit`

### Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Authenticate with Reddit**
   ```bash
   npm run login
   ```

3. **Configure your dev subreddit** in `devvit.json`:
   ```json
   "dev": { "subreddit": "your_dev_subreddit" }
   ```

4. **Set your OpenAI API key** for local development — create a `.env` file:
   ```
   OPEN_API_KEY=sk-...
   ```
   In production, set it via the subreddit app settings panel after deploying.

5. **Start developing**
   ```bash
   npm run dev
   ```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start live playtest on your dev subreddit |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run test` | Run tests |
| `npm run deploy` | Type-check + lint + test + upload to Reddit |
| `npm run launch` | Deploy + submit for Reddit app review |

## Configuration

After deploying, subreddit moderators can configure Vibe Guard from the subreddit app settings panel:

| Setting | Default | Description |
|---|---|---|
| OpenAI API Key | — | Required. Set once at the app level, shared across all installations. |
| Auto-Remove Threshold | `0.7` | Confidence score above which a comment in a critical category is auto-removed. |
| Flag-for-Review Threshold | `0.5` | Confidence score above which any flagged comment is queued for mod review. |
| Modmail Notifications | `true` | Send a modmail to the mod team on every auto-removal and flag. |

## How It Works

1. A comment is posted in the subreddit
2. Devvit fires `onCommentSubmit` → Vibe Guard calls the OpenAI Moderation API
3. The result is classified into AUTO_REMOVE, FLAG_FOR_REVIEW, or IGNORE
4. **AUTO_REMOVE**: comment is removed, a removal reason is attached, a mod note is added to the author's account, and a modmail is sent to the mod team
5. **FLAG_FOR_REVIEW**: the comment stays visible, but is stored in the review queue and a modmail alert is sent
6. Mods can use the **Review Queue** menu item on any post to see pending items, or click **Restore Comment** on a specific comment to approve it

## Deployment

1. Test thoroughly on your dev subreddit with `npm run dev`
2. Deploy to Reddit: `npm run deploy`
3. Set the OpenAI API key in the app settings
4. Submit for review: `npm run launch`
5. Once approved, mods can install Vibe Guard from the Reddit app directory

## License

BSD-3-Clause
