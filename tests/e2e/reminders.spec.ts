import { test, expect, type Page } from '@playwright/test';
import { defaultProfile } from '../../src/lib/schema';
// The ordinary preview suite deliberately runs without Supabase configuration.
// This suite needs dummy public values so the app loads its mocked bootstrap.
test.skip(
  process.env.PLAYWRIGHT_REMINDERS_CONFIGURED !== '1',
  'Start the app with dummy public Supabase values and set PLAYWRIGHT_REMINDERS_CONFIGURED=1.',
);
async function setup(page: Page, denied = false) {
  await page.addInitScript(
    ({ denied }) => {
      const sub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/example',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/example',
          keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
        }),
        unsubscribe: async () => {
          current = null;
          return true;
        },
      };
      let current: typeof sub | null = null;
      const registration = {
        pushManager: {
          getSubscription: async () => current,
          subscribe: async () => {
            current = sub;
            return sub;
          },
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: {
          getRegistration: async () => registration,
          register: async () => registration,
          ready: Promise.resolve(registration),
        },
      });
      Object.defineProperty(window, 'PushManager', { value: class {} });
      Object.defineProperty(window, 'Notification', {
        value: {
          permission: denied ? 'denied' : 'default',
          requestPermission: async () => 'granted',
        },
      });
    },
    { denied },
  );
  let settings = {
    time: '19:30',
    timeZone: 'Asia/Kolkata',
    enabled: false,
    configured: true,
    publicKey: 'B'.repeat(87),
    browsers: 0,
  };
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      json: {
        user: { id: 'learner', email: 'learner@example.com' },
        profile: defaultProfile,
        sessions: [],
        exercises: [],
        vocabulary: [],
        reports: [],
        voiceConfigured: true,
      },
    }),
  );
  await page.route('**/api/reminders', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: settings });
    const body = route.request().postDataJSON();
    writes.push(body);
    settings = {
      ...settings,
      time: body.time,
      timeZone: body.timeZone,
      enabled: body.enabled,
      browsers: body.subscription ? 1 : settings.browsers,
    };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/settings');
  await expect(
    page.getByRole('button', { name: 'Enable daily reminder', exact: true }),
  ).toBeEnabled();
  return writes;
}
test('saves the 7:30 PM IST browser reminder, then lets the user turn it off', async ({
  page,
}, info) => {
  const writes = await setup(page);
  const reminder = page.getByRole('region', { name: 'Daily practice reminder' });
  await expect(reminder.getByLabel('Reminder time')).toHaveValue('19:30');
  await reminder.getByRole('button', { name: 'Enable daily reminder', exact: true }).click();
  await expect(reminder.getByText('Daily reminder saved.', { exact: false })).toBeVisible();
  expect(writes[0]).toMatchObject({
    time: '19:30',
    timeZone: 'Asia/Kolkata',
    enabled: true,
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/example' },
  });
  await page.screenshot({ path: `test-results/reminder-${info.project.name}.png`, fullPage: true });
  await reminder.getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(
    reminder.getByText('Daily reminders are turned off.', { exact: true }),
  ).toBeVisible();
  expect(writes.at(-1)).toMatchObject({ enabled: false });
});
test('blocked browser permission gives recovery instructions and never enables a server reminder', async ({
  page,
}) => {
  const writes = await setup(page, true);
  await page.getByRole('button', { name: 'Enable daily reminder', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Notifications are blocked' }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
});
