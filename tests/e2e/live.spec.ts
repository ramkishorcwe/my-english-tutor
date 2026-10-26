import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const id = '90000000-0000-4000-8000-000000000001';
const turnId = '90000000-0000-4000-8000-000000000002';
const makeSession = () => ({
  id,
  topic: 'A gentle introduction',
  mode: 'Free conversation',
  difficulty: 'Comfortable',
  duration: 10,
  input_mode: 'hands-free',
  created_at: new Date().toISOString(),
  ended_at: null,
  status: 'active',
  report_status: 'pending',
});

test('live microphone denial gives recovery instructions', async ({ page }, testInfo) => {
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session: makeSession(), turns: [], report: null } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Connect microphone', exact: true }).click();
  await expect(page.locator('.alert[role="alert"]')).toContainText('site permissions');
  await expect(page.getByRole('button', { name: 'Try microphone again' })).toBeVisible();
  await page.screenshot({ path: `test-results/live-${testInfo.project.name}.png`, fullPage: true });
});
test('unsent transcript recovers, syncs, and survives refresh', async ({ page }) => {
  let serverTurns: { id: string; role: string; text: string; sequence: number }[] = [];
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session: makeSession(), turns: serverTurns, report: null } }),
  );
  await page.route(`**/api/sessions/${id}/turns`, async (route) => {
    serverTurns = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.evaluate(
    ({ id, turnId }) =>
      sessionStorage.setItem(
        `speakbetter:undefined:${id}`,
        JSON.stringify([
          { id: turnId, role: 'user', text: 'Yesterday I went to a cafe.', sequence: 0 },
        ]),
      ),
    { id, turnId },
  );
  await page.goto(`/practice/${id}`);
  await expect(page.getByText('Yesterday I went to a cafe.', { exact: true })).toBeVisible();
  await expect.poll(() => serverTurns.length).toBe(1);
  await page.evaluate(({ id }) => sessionStorage.removeItem(`speakbetter:undefined:${id}`), { id });
  await page.reload();
  await expect(page.getByText('Yesterday I went to a cafe.', { exact: true })).toBeVisible();
});

test('paused tutor audio can be restored and replayed without reconnecting', async ({
  page,
}, info) => {
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session: makeSession(), turns: [] } }),
  );
  await page.route(`**/api/sessions/${id}/token`, (route) =>
    route.fulfill({
      json: {
        token: 'auth_tokens/browser-test',
        model: 'test-model',
        config: { responseModalities: ['AUDIO'] },
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    }),
  );
  await page.route(`**/api/sessions/${id}/turns`, (route) => route.fulfill({ json: { ok: true } }));
  let connections = 0;
  await page.routeWebSocket('wss://generativelanguage.googleapis.com/**', (socket) => {
    connections++;
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
      if (message.clientContent?.turnComplete)
        socket.send(
          JSON.stringify({
            serverContent: {
              outputTranscription: {
                text: 'Hello! What would you like to discuss?',
                finished: true,
              },
              modelTurn: {
                parts: [
                  { inlineData: { data: 'AAAA'.repeat(8000), mimeType: 'audio/pcm;rate=24000' } },
                ],
              },
              turnComplete: true,
            },
          }),
        );
    });
  });
  await page.addInitScript(() => {
    const Base = window.AudioContext;
    let suspended = false;
    class Context extends Base {
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args: Parameters<AudioBufferSourceNode['start']>) => {
          start(...args);
          if (!suspended) {
            suspended = true;
            void this.suspend();
          }
        };
        return source;
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => new Base().createMediaStreamDestination().stream,
    });
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Connect microphone', exact: true }).click();
  await expect(
    page.getByText('Hello! What would you like to discuss?', { exact: true }),
  ).toBeVisible();
  const sound = page.getByRole('button', { name: 'Enable tutor sound', exact: true });
  await expect(sound).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include('.sound-recovery')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: `test-results/sound-recovery-${info.project.name}.png`,
    fullPage: true,
  });
  await sound.click();
  await expect(sound).not.toBeVisible();
  await page.getByRole('button', { name: 'Replay latest AI response' }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeEnabled();
  expect(connections).toBe(1);
});

test('an existing push-to-talk conversation switches to hands-free and keeps streaming across replies', async ({
  page,
}, info) => {
  const session = { ...makeSession(), input_mode: 'push-to-talk' };
  const existing = {
    id: turnId,
    role: 'user',
    text: 'I want to keep talking naturally.',
    sequence: 0,
  };
  await page.route(`**/api/sessions/${id}`, (route) =>
    route.fulfill({ json: { session, turns: [existing] } }),
  );
  const requestedModes: string[] = [];
  await page.route(`**/api/sessions/${id}/token`, (route) => {
    const mode = route.request().postDataJSON().input_mode;
    requestedModes.push(mode);
    session.input_mode = mode;
    return route.fulfill({
      json: {
        token: 'auth_tokens/voice-test',
        model: 'test-model',
        config: {
          responseModalities: ['AUDIO'],
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: mode === 'push-to-talk' },
          },
        },
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    });
  });
  await page.route(`**/api/sessions/${id}/turns`, (route) => route.fulfill({ json: { ok: true } }));
  let frames = 0,
    replies = 0;
  await page.routeWebSocket('wss://generativelanguage.googleapis.com/**', (socket) => {
    function reply() {
      replies++;
      socket.send(
        JSON.stringify({
          serverContent: {
            outputTranscription: { text: `Coach reply ${replies}`, finished: true },
            modelTurn: {
              parts: [
                { inlineData: { data: 'AAAA'.repeat(800), mimeType: 'audio/pcm;rate=24000' } },
              ],
            },
            turnComplete: true,
          },
        }),
      );
    }
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
      if (message.clientContent?.turnComplete) reply();
      if (message.realtimeInput?.audio || message.realtimeInput?.mediaChunks?.length) {
        frames++;
        if (frames % 5 === 0 && replies < 5) reply();
      }
    });
  });
  await page.addInitScript(() => {
    const Base = window.AudioContext;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const audio = new Base();
        const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        oscillator.frequency.value = 220;
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
  await page.goto(`/practice/${id}`);
  await page.getByRole('button', { name: 'Connect microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hold to speak', exact: true })).toBeVisible();
  expect(requestedModes).toEqual(['push-to-talk']);
  expect(frames).toBe(0);
  await page.getByRole('button', { name: 'Use hands-free conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible();
  await expect.poll(() => frames).toBeGreaterThan(15);
  expect(replies).toBeGreaterThanOrEqual(3);
  expect(requestedModes).toEqual(['push-to-talk', 'hands-free']);
  await expect(page.getByText(existing.text, { exact: true })).toBeVisible();
  await expect(
    page.getByText('Hands-free · Mic stays on · Tap only to mute', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  const resumed = frames;
  await expect.poll(() => frames).toBeGreaterThan(resumed + 5);
  await page.screenshot({
    path: `test-results/hands-free-${info.project.name}.png`,
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Use hands-free conversation', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.live-top')).toContainText('Hands-free');
});
