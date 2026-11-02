import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { defaultProfile } from '../../src/lib/schema';
async function setup(page: Page) {
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        user: { id: 'pronunciation-learner', email: 'learner@example.com' },
        profile: defaultProfile,
        sessions: [],
        exercises: [],
        vocabulary: [],
        reports: [],
        voiceConfigured: true,
      },
    }),
  );
  await page.addInitScript(() => {
    const testState = { spoken: [] as string[], tracksStopped: 0 };
    Object.defineProperty(window, 'pronunciationTest', { value: testState });
    class Utterance {
      text: string;
      lang = '';
      rate = 1;
      onend: null | (() => void) = null;
      onerror = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        cancel() {},
        resume() {},
        getVoices: () => [{ lang: 'en-US', name: 'Test English' }],
        speak(utterance: Utterance) {
          testState.spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 20);
        },
      },
    });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => ({
        getTracks: () => [
          {
            stop() {
              testState.tracksStopped++;
            },
          },
        ],
      }),
    });
    const wav = new ArrayBuffer(44 + 16000 * 2);
    const view = new DataView(wav);
    const text = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, wav.byteLength - 8, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, 32000, true);
    for (let i = 0; i < 16000; i++)
      view.setInt16(44 + i * 2, Math.round(Math.sin(i * 0.1) * 3000), true);
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: null | ((event: { data: Blob }) => void) = null;
      onstop: null | (() => void) = null;
      onerror = null;
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob([wav], { type: 'audio/wav' }) });
          this.onstop?.();
        }, 0);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder });
  });
}
async function spoken(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { pronunciationTest: { spoken: string[] } }).pronunciationTest.spoken,
  );
}
test.skip(
  process.env.PLAYWRIGHT_WRITING_CONFIGURED !== '1',
  'Requires dummy public Supabase settings.',
);
test('reads any English text and offers slow playback', async ({ page }) => {
  await setup(page);
  await page.goto('/pronunciation');
  await page
    .getByRole('textbox', { name: 'English word or text' })
    .fill('I want to pronounce unfamiliar words clearly.');
  await page.getByRole('checkbox', { name: 'Speak slowly' }).check();
  await page.getByRole('button', { name: 'Read aloud', exact: true }).click();
  await expect.poll(() => spoken(page)).toContain('I want to pronounce unfamiliar words clearly.');
});
test('demonstrates failed attempts, keeps the same word, and advances only after a clear recording', async ({
  page,
}, info) => {
  await setup(page);
  let attempts = 0;
  await page.route('**/api/pronunciation', (route) => {
    attempts++;
    return route.fulfill({
      json: {
        wordId: 'comfortable',
        verdict: attempts === 1 ? 'try_again' : 'clear',
        confidence: 'high',
        heard: 'comfortable',
        feedback:
          attempts === 1 ? 'Try making the middle syllable shorter.' : 'That word was clear.',
        tip: attempts === 1 ? 'Listen to the slow example, then say it once.' : '',
      },
    });
  });
  await page.goto('/pronunciation');
  await page.getByRole('button', { name: 'Practise hard words', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'comfortable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record my pronunciation', exact: true }).click();
  await page.getByRole('button', { name: 'Stop & check pronunciation', exact: true }).click();
  await expect(page.getByText('Try making the middle syllable shorter.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'comfortable', exact: true })).toBeVisible();
  await expect.poll(() => spoken(page)).toContain('comfortable');
  await page.screenshot({
    path: `test-results/pronunciation-retry-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Try this word again', exact: true }).click();
  await page.getByRole('button', { name: 'Stop & check pronunciation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'vegetable', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Practise hard words', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'vegetable', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('low-confidence and mismatched-word passes do not unlock the next word', async ({ page }) => {
  await setup(page);
  await page.route('**/api/pronunciation', (route) =>
    route.fulfill({
      json: {
        wordId: 'comfortable',
        verdict: 'clear',
        confidence: 'low',
        heard: 'banana',
        feedback: 'Maybe clear.',
        tip: '',
      },
    }),
  );
  await page.goto('/pronunciation');
  await page.getByRole('button', { name: 'Practise hard words', exact: true }).click();
  await page.getByRole('button', { name: 'Record my pronunciation', exact: true }).click();
  await page.getByRole('button', { name: 'Stop & check pronunciation', exact: true }).click();
  await expect(
    page.getByText(
      'I could not confidently verify that word. Listen to the example and try again.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'comfortable', exact: true })).toBeVisible();
});
test('microphone denial and coach errors allow retry without losing the word', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Denied', 'NotAllowedError');
      },
    }),
  );
  await page.goto('/pronunciation');
  await page.getByRole('button', { name: 'Practise hard words', exact: true }).click();
  await page.getByRole('button', { name: 'Record my pronunciation', exact: true }).click();
  await expect(page.locator('.pronunciation-challenge [role="alert"]')).toContainText(
    'Microphone access was denied',
  );
  await expect(page.getByRole('heading', { name: 'comfortable', exact: true })).toBeVisible();
});
