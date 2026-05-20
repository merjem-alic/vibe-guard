# Vibe Guard

An AI-powered Reddit moderation tool built with [Devvit](https://developers.reddit.com/), [Hono](https://hono.dev/), and [OpenAI](https://platform.openai.com/docs/guides/moderation). Vibe Guard automatically screens comments and posts for toxic content and gives moderators a complete review and action workflow — all inside Reddit's native UI.

## Features

### Automatic AI Moderation
- Every new **comment** and **post** is evaluated by OpenAI's `omni-moderation-latest` model in real time
- **Tiered response system** based on category confidence scores:
  - **Auto-Remove** (score > 0.7): `sexual/minors`, `hate/threatening`, `violence/graphic`, `self-harm/instructions`, `self-harm/intent` — removed instantly
  - **Flag for Review** (score > 0.5): all other flagged categories — content stays up, mods alerted
  - **Ignore**: everything below threshold — no action taken
- Categories and thresholds are fully configurable per-subreddit via app settings
- **Report-triggered re-screening**: when a user reports a comment, it is re-evaluated by OpenAI and escalated to auto-remove if warranted
- **Repeat offender detection**: authors with 3+ violations get an escalating mod note (`[REPEAT OFFENDER ×N]`) attached to each action
- Removed content automatically receives a subreddit removal reason and a mod note on the author's account
- Modmail notification sent to the mod team for every auto-removal and flag, including author, category, confidence score, and a direct permalink
- **API failure handling**: all OpenAI calls retry up to 3 times (1s/2s/4s backoff) on transient errors; configurable fail-open or fail-closed behaviour when the API is unreachable

### Manual Moderation Tools
- **Mop comment** — remove and/or lock a comment and all its replies in one click
- **Mop post** — remove and/or lock every comment on a post at once
- **Restore** — approve a Vibe Guard–flagged comment or post directly from the review queue; works for both T1 and T3 IDs
- **Confirm Removal** — mod confirms a FLAG_FOR_REVIEW comment or post should be removed; toast shows the author's total violation count
- **Dismiss Item** — mark a pending item as reviewed and close it from the queue without removing the content

### Mod Dashboard (native Reddit UI)
- **Review Queue** — accessible from any post; shows total processed / auto-removed / pending counts and the last 10 flagged items with full context (author, category, confidence, status, body snippet, permalink)
- **Settings** — view current thresholds, dry-run / failure-mode flags, live stats, and a category breakdown of recent flagged items — without leaving Reddit

### Safe Deployment Features
- **Dry-run mode** — when enabled, AUTO_REMOVE decisions are stored as pending in the queue (no content is actually removed); modmail is sent with a `[DRY RUN]` prefix so mods can calibrate thresholds against live traffic before enabling enforcement
- **Trusted user allowlist** — comma-separated list of usernames that bypass all AI screening entirely; avoids false positives on established community members and moderators
- **Fail-closed mode** — when OpenAI is unreachable after retries, content is automatically flagged for review instead of silently passing through

### Persistence & Auditability
- All flagged items stored in Redis with full metadata: author, body, category, score, tier, status, content type, permalink, and timestamp
- Status lifecycle: `pending` → `auto-removed` / `restored` / `confirmed` / `deleted` / `dismissed`
- Daily processed counters (`vg:stats:processed:YYYY-MM-DD`) enable weekly rollup reporting
- Per-author violation counts tracked for repeat offender escalation
- Running counters for total processed, auto-removed, and pending items

### Reporting
- **Weekly digest** scheduled every Monday at 9am UTC — posts a modmail summary of the past 7 days of activity, all-time auto-remove count, and current pending queue depth
- **Debug endpoint** (`GET /api/debug/stats`) returns live stats and the 10 most recent flagged items as JSON — useful during development

## Tech Stack

| Layer | Technology |
|---|---|
| Platform | [Devvit](https://developers.reddit.com/) 0.12.x |
| Server | [Hono](https://hono.dev/) + `@hono/node-server` |
| Build | [Vite](https://vite.dev/) with `@devvit/start/vite` |
| AI | [OpenAI](https://platform.openai.com/) Moderation API (`omni-moderation-latest`) |
| Storage | Devvit Redis |
| Language | TypeScript |

## Project Structure

```
src/
├── index.ts                  # Server entry — Hono app, Devvit settings registration
├── core/
│   ├── moderation.ts         # Classification logic + callWithRetry helper
│   ├── moderation.test.ts    # Unit tests: classification and category parsing
│   ├── flaggedStore.ts       # Redis persistence — flagged items, counters, daily stats, author violations
│   ├── flaggedStore.test.ts  # Unit tests: all Redis store functions
│   ├── nuke.ts               # Bulk comment remove/lock operations
│   └── nuke.test.ts          # Unit tests: handleNuke and handleNukePost
└── routes/
    ├── triggers.ts           # Event handlers: onAppInstall, onCommentSubmit, onPostSubmit,
    │                         #   onCommentReport, onCommentDelete, weekly-digest scheduler
    ├── triggers.test.ts      # Unit tests: trigger decision paths (7 scenarios)
    ├── menu.ts               # Context menu item handlers
    ├── forms.ts              # Form submission handlers
    └── api.ts                # Public API endpoints (debug/stats)
scripts/
└── seed-test-comments.mjs    # Dev testing: posts comments from two alt accounts via snoowrap
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
| `npm run test` | Run unit tests (vitest) |
| `npm run deploy` | Type-check + lint + test + upload to Reddit |
| `npm run launch` | Deploy + submit for Reddit app review |

## Configuration

After deploying, subreddit moderators can configure Vibe Guard from the subreddit app settings panel:

| Setting | Default | Description |
|---|---|---|
| OpenAI API Key | — | Required. Set once at the app level, shared across all installations. |
| Auto-Remove Threshold | `0.7` | Confidence score above which content in a critical category is auto-removed. |
| Flag-for-Review Threshold | `0.5` | Confidence score above which any flagged content is queued for mod review. |
| Modmail Notifications | `true` | Send a modmail to the mod team on every auto-removal and flag. |
| Auto-Remove Categories | `sexual/minors,...` | Comma-separated list of OpenAI categories that trigger auto-removal. Overrides the default set. |
| Dry-Run Mode | `false` | When enabled, AUTO_REMOVE decisions are logged and queued for review but content is not removed. Use to calibrate thresholds before going live. |
| Trusted Users | — | Comma-separated list of usernames that bypass AI screening entirely. |
| Moderation Failure Mode | `fail-open` | `fail-open`: let content through silently if OpenAI is unreachable. `fail-closed`: flag it for mod review instead. |

## How It Works

### Comment / Post Flow
1. Content is submitted to the subreddit
2. Devvit fires `onCommentSubmit` or `onPostSubmit` → Vibe Guard calls the OpenAI Moderation API (with up to 3 automatic retries on transient errors)
3. The result is classified into AUTO_REMOVE, FLAG_FOR_REVIEW, or IGNORE
4. **AUTO_REMOVE**: content is removed, a removal reason is attached, a mod note is added to the author's account (with repeat offender escalation if applicable), and a modmail is sent
5. **FLAG_FOR_REVIEW**: content stays visible, stored in the review queue, modmail alert sent
6. Mods can use **Confirm Removal** on a specific comment to confirm the AI's decision, **Restore Comment** to approve it, or **Dismiss Item** to close it from the queue without acting on the content

### Report Flow
1. A user reports a comment
2. `onCommentReport` fires → Vibe Guard re-screens the comment through OpenAI
3. If the re-screen returns AUTO_REMOVE and it wasn't already removed, it is removed and the queue updated

### Delete Flow
1. A user deletes their own comment
2. `onCommentDelete` fires → if the comment was pending review, the pending counter is decremented automatically (prevents drift)

### API Failure Flow
1. OpenAI call fails (network error, 429, 5xx) → Vibe Guard retries up to 3 times with exponential backoff
2. If all retries fail and **fail-open** (default): content passes through silently, error logged
3. If all retries fail and **fail-closed**: content is stored as a `FLAG_FOR_REVIEW` item with `category: api-error` so mods can review it

## Testing

### Unit Tests
```bash
npm run test
```

39 tests across 4 files:

| File | Tests | Covers |
|---|---|---|
| `core/moderation.test.ts` | 14 | Classification logic, category parsing |
| `core/flaggedStore.test.ts` | 12 | Redis store functions, counters, violation tracking |
| `core/nuke.test.ts` | 6 | Bulk remove/lock, permission checks, skipDistinguished |
| `routes/triggers.test.ts` | 7 | IGNORE/FLAG/AUTO_REMOVE paths, trusted user bypass, fail-closed, dry-run |

### Integration Testing with Alt Accounts
```bash
# Set env vars, then:
node scripts/seed-test-comments.mjs
```
The seeder posts 7 comments (3 IGNORE, 2 FLAG_FOR_REVIEW, 2 AUTO_REMOVE) from two test accounts to a target post. See the script header for full setup instructions.

## Deployment

1. Test thoroughly on your dev subreddit with `npm run dev`
2. Deploy to Reddit: `npm run deploy`
3. Set the OpenAI API key in the app settings
4. Submit for review: `npm run launch`
5. Once approved, mods can install Vibe Guard from the Reddit app directory

## License

BSD-3-Clause
