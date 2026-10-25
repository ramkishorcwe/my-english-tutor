import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { defaultProfile } from '../../src/lib/schema';
import type { WritingThread, WritingReview } from '../../src/lib/writing';
test.skip(
  process.env.PLAYWRIGHT_WRITING_CONFIGURED !== '1',
  'Start with dummy public Supabase values and PLAYWRIGHT_WRITING_CONFIGURED=1.',
);
const id = '80000000-0000-4000-8000-000000000001';
async function setup(
  page: Page,
  failOnce = false,
  options: { replyGate?: Promise<void>; failBeforeSave?: boolean } = {},
) {
  const thread: WritingThread = {
    chat: {
      id,
      topic: 'Surprise me',
      status: 'active',
      created_at: new Date().toISOString(),
      review: null,
    },
    turns: [],
    pending: null,
  };
  const requests: { requestId: string; text: string | null }[] = [];
  let failed = false;
  const createdTopics: string[] = [];
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        user: { id: 'learner', email: 'learner@example.com' },
        profile: defaultProfile,
        sessions: [],
        reports: [],
        exercises: [],
        vocabulary: [],
        voiceConfigured: true,
      },
    }),
  );
  await page.route('**/api/chats', (route) => {
    if (route.request().method() !== 'GET') {
      thread.chat.topic = route.request().postDataJSON().topic;
      createdTopics.push(thread.chat.topic);
    }
    return route.fulfill({
      json: route.request().method() === 'GET' ? { chats: [thread.chat] } : { id },
    });
  });
  await page.route(`**/api/chats/${id}`, (route) => route.fulfill({ json: thread }));
  await page.route(`**/api/chats/${id}/message`, async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (!body.text) {
      if (!thread.turns.length)
        thread.turns.push({
          id: crypto.randomUUID(),
          role: 'model',
          sequence: 0,
          text: 'I’m your AI tutor. What did you do yesterday?',
        });
    } else {
      if (options.replyGate) await options.replyGate;
      if (options.failBeforeSave && !failed) {
        failed = true;
        return route.fulfill({
          status: 503,
          json: { error: 'Connection failed before your message was saved.' },
        });
      }
      if (!thread.turns.some((t) => t.id === body.requestId))
        thread.turns.push({
          id: body.requestId,
          role: 'user',
          text: body.text,
          sequence: thread.turns.length,
        });
      if (failOnce && !failed) {
        failed = true;
        thread.pending = body;
        return route.fulfill({
          status: 503,
          json: { error: 'The tutor is busy. Your message is saved.' },
        });
      }
      thread.turns.push({
        id: crypto.randomUUID(),
        role: 'model',
        text: 'What was the best part of your day?',
        sequence: thread.turns.length,
      });
      thread.pending = null;
    }
    return route.fulfill({ json: thread });
  });
  await page.route(`**/api/chats/${id}/end`, (route) => {
    thread.chat.status = 'ended';
    return route.fulfill({ json: { ok: true } });
  });
  await page.route(`**/api/chats/${id}/review`, (route) => {
    const review: WritingReview = {
      summary:
        'You practised talking about yesterday’s activities. You described a visit to a shop, and your partner asked about the best part of your day.',
      messages: thread.turns
        .filter((t) => t.role === 'user')
        .map((t) => ({
          turnId: t.id,
          corrected: 'The previous day I went to the shop.',
          corrections: [
            {
              original: 'I go',
              corrected: 'I went',
              explanation: 'Use past tense when talking about yesterday.',
              kind: 'correction',
            },
            {
              original: 'to shop',
              corrected: 'to the shop',
              explanation: 'Use the article for this shop.',
              kind: 'correction',
            },
            {
              original: 'Yesterday',
              corrected: 'The previous day',
              explanation: 'Both are correct; this is an optional alternative.',
              kind: 'optional',
            },
          ],
        })),
    };
    thread.chat.review = review;
    return route.fulfill({ json: review });
  });
  return { thread, requests, createdTopics };
}
test('AI starts a written conversation and the final review highlights the learner’s mistakes', async ({
  page,
}, info) => {
  const { thread, createdTopics } = await setup(page);
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Job interview', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Roles and situation (optional)' })).toHaveValue(
    /You are a hiring manager/,
  );
  await page.getByRole('button', { name: 'Start writing chat', exact: true }).click();
  expect(createdTopics[0]).toContain('I am a job candidate');
  await expect(
    page.getByText('I’m your AI tutor. What did you do yesterday?', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Your message', exact: true })
    .fill('Yesterday I go to shop.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('What was the best part of your day?', { exact: true }),
  ).toBeVisible();
  expect(thread.turns.filter((t) => t.role === 'user')).toHaveLength(1);
  await page.getByRole('button', { name: 'End & review writing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your writing, reviewed.', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.writing-original mark')).toHaveText(['I go', 'to shop']);
  await expect(page.locator('.writing-corrected')).toHaveText(
    'The previous day I went to the shop.',
  );
  await expect(page.getByText('Optional improvement', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Conversation summary', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.writing-summary')).toContainText('yesterday’s activities');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `test-results/writing-review-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator('.writing-corrected')).toHaveText(
    'The previous day I went to the shop.',
  );
  await expect(page.locator('.writing-summary')).toContainText('yesterday’s activities');
});
test('a failed tutor reply retries the same saved message without duplication', async ({
  page,
}) => {
  const { thread, requests } = await setup(page, true);
  await page.goto(`/chat/${id}`);
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(
    page.getByText('I’m your AI tutor. What did you do yesterday?', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Your message', exact: true })
    .fill('Yesterday I go to shop.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.writing-message.user')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('My next thought.');
  await page.getByRole('button', { name: 'Retry tutor reply', exact: true }).click();
  await expect(
    page.getByText('What was the best part of your day?', { exact: true }),
  ).toBeVisible();
  expect(requests[1].requestId).toBe(requests[2].requestId);
  expect(thread.turns.filter((t) => t.role === 'user')).toHaveLength(1);
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue(
    'My next thought.',
  );
});

test('Send clears immediately, shows the message before a delayed response, and preserves the next draft', async ({
  page,
}, info) => {
  let release!: () => void;
  const replyGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { requests } = await setup(page, false, { replyGate });
  await page.goto(`/chat/${id}`);
  const input = page.getByRole('textbox', { name: 'Your message', exact: true });
  await expect(input).toBeEnabled();
  await input.fill('Yesterday I go to shop.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    await expect(input).toHaveValue('');
    await expect(input).toBeEnabled();
    await expect(page.locator('.writing-message.user')).toHaveText(/Yesterday I go to shop/);
    await expect(page.getByRole('status')).toContainText('Your tutor is typing');
    await expect(
      page.getByText('What was the best part of your day?', { exact: true }),
    ).toHaveCount(0);
    await input.fill('This is my next message.');
    await input.press('Enter');
    expect(requests.filter((r) => r.text)).toHaveLength(1);
    await input.press('Shift+Enter');
    await expect(input).toHaveValue('This is my next message.\n');
    await page.screenshot({
      path: `test-results/writing-sending-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    release();
  }
  await expect(
    page.getByText('What was the best part of your day?', { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('This is my next message.\n');
  await expect(page.locator('.writing-message.user')).toHaveCount(1);
  await page.reload();
  await expect(input).toHaveValue('This is my next message.\n');
  await input.press('Enter');
  await expect(page.locator('.writing-message.user')).toHaveCount(2);
});

test('a message that did not reach the server survives refresh and retries with its original ID', async ({
  page,
}) => {
  const { requests, thread } = await setup(page, false, { failBeforeSave: true });
  await page.goto(`/chat/${id}`);
  const input = page.getByRole('textbox', { name: 'Your message', exact: true });
  await expect(input).toBeEnabled();
  await input.fill('Yesterday I go to shop.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry tutor reply', exact: true })).toBeVisible();
  expect(thread.turns.filter((t) => t.role === 'user')).toHaveLength(0);
  await input.fill('Keep this next draft too.');
  await page.reload();
  await expect(page.locator('.writing-message.user')).toHaveText(/Yesterday I go to shop/);
  await expect(input).toHaveValue('Keep this next draft too.');
  await page.getByRole('button', { name: 'Retry tutor reply', exact: true }).click();
  await expect(
    page.getByText('What was the best part of your day?', { exact: true }),
  ).toBeVisible();
  expect(requests[1].requestId).toBe(requests[2].requestId);
  await expect(page.locator('.writing-message.user')).toHaveCount(1);
  await expect(input).toHaveValue('Keep this next draft too.');
});

test('longer messages send successfully and a chat message can be opened in the translator', async ({
  page,
}) => {
  const { thread } = await setup(page);
  await page.goto(`/chat/${id}`);
  const input = page.getByRole('textbox', { name: 'Your message', exact: true });
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('maxlength', '5000');
  const text = 'I am practising written English for work. '.repeat(100);
  expect(text.length).toBeGreaterThan(2000);
  await input.fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('What was the best part of your day?', { exact: true }),
  ).toBeVisible();
  expect(thread.turns.find((t) => t.role === 'user')?.text).toBe(text.trim());
  await page
    .locator('.writing-message.user')
    .getByRole('button', { name: 'Translate message', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Word, phrase, or text' })).toHaveValue(
    text.trim(),
  );
});
