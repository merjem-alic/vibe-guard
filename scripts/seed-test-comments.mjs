/**
 * Vibe Guard Test Comment Seeder
 *
 * Posts a mix of clean and policy-violating comments from two Reddit alt accounts
 * to a target post in r/vibe_guard_dev, so you can verify the bot's tiers live.
 *
 * Setup:
 *   1. Register a Reddit "script" OAuth app at https://www.reddit.com/prefs/apps
 *      (type = "script", redirect URI = http://localhost:8080)
 *   2. Create two alt Reddit accounts, verify their email addresses.
 *   3. Wait 24-48h before posting — new accounts get shadowbanned by Reddit spam filters.
 *   4. Create a test post in r/vibe_guard_dev and copy its ID (the t3_xxxxx part of the URL).
 *   5. Set the environment variables below, then run:
 *        node scripts/seed-test-comments.mjs
 *
 * Required env vars:
 *   CLIENT_ID       — Reddit OAuth app client ID
 *   CLIENT_SECRET   — Reddit OAuth app client secret
 *   REDDIT_USER_A   — Username of first test account
 *   REDDIT_PASS_A   — Password of first test account
 *   REDDIT_USER_B   — Username of second test account
 *   REDDIT_PASS_B   — Password of second test account
 *   POST_ID         — Full post ID, e.g. "t3_abcdef"
 */

import Snoowrap from 'snoowrap';

const REQUIRED_VARS = [
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REDDIT_USER_A',
  'REDDIT_PASS_A',
  'REDDIT_USER_B',
  'REDDIT_PASS_B',
  'POST_ID',
];

for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`Missing required env var: ${v}`);
    process.exit(1);
  }
}

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDDIT_USER_A,
  REDDIT_PASS_A,
  REDDIT_USER_B,
  REDDIT_PASS_B,
  POST_ID,
} = process.env;

const USER_AGENT = 'vibe-guard-test-seeder/1.0';

const clientA = new Snoowrap({
  userAgent: USER_AGENT,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  username: REDDIT_USER_A,
  password: REDDIT_PASS_A,
});

const clientB = new Snoowrap({
  userAgent: USER_AGENT,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  username: REDDIT_USER_B,
  password: REDDIT_PASS_B,
});

// Comment scenarios covering all three tiers
const COMMENTS = [
  {
    account: 'A',
    text: 'Great post! Really appreciate the community effort here. Keep it up.',
    expected: 'IGNORE',
  },
  {
    account: 'B',
    text: 'This is interesting content. I learned something new today.',
    expected: 'IGNORE',
  },
  {
    account: 'A',
    text: 'I disagree with this perspective but I respect that others see it differently.',
    expected: 'IGNORE',
  },
  {
    account: 'B',
    text: 'People who think like this are garbage and should be ashamed of themselves.',
    expected: 'FLAG_FOR_REVIEW',
  },
  {
    account: 'A',
    text: 'This content is dangerous and harmful. I hate everyone involved in making it.',
    expected: 'FLAG_FOR_REVIEW',
  },
  {
    account: 'B',
    text: 'I want to hurt myself because of stuff like this. No one cares anyway.',
    expected: 'AUTO_REMOVE',
  },
  {
    account: 'A',
    text: 'Here are detailed instructions for how to harm someone physically using household items.',
    expected: 'AUTO_REMOVE',
  },
];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postComment(client, username, postId, text) {
  const post = await client.getSubmission(postId.replace('t3_', '')).fetch();
  const comment = await post.reply(text);
  return comment.name;
}

console.log(`\nVibe Guard Test Comment Seeder`);
console.log(`Target post: ${POST_ID}`);
console.log(`Accounts: ${REDDIT_USER_A} (A), ${REDDIT_USER_B} (B)`);
console.log(`\nPosting ${COMMENTS.length} comments...\n`);

for (let i = 0; i < COMMENTS.length; i++) {
  const { account, text, expected } = COMMENTS[i];
  const client = account === 'A' ? clientA : clientB;
  const username = account === 'A' ? REDDIT_USER_A : REDDIT_USER_B;

  try {
    const commentId = await postComment(client, username, POST_ID, text);
    console.log(`[${i + 1}/${COMMENTS.length}] u/${username} → ${commentId}`);
    console.log(`   Expected: ${expected}`);
    console.log(`   Text: "${text.slice(0, 60)}..."`);
  } catch (err) {
    console.error(`[${i + 1}/${COMMENTS.length}] FAILED (u/${username}): ${err.message}`);
  }

  // Rate limit: 2 seconds between posts
  if (i < COMMENTS.length - 1) {
    await sleep(2000);
  }
}

console.log('\nDone. Check the Vibe Guard review queue and modmail in r/vibe_guard_dev.');
console.log('Use GET /api/debug/stats to verify counts updated correctly.\n');
