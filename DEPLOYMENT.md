# SpeakBetter deployment on Vercel

Use Vercel for the frontend **and the Next.js API routes**. Use Supabase for authentication and PostgreSQL. The browser connects directly to Gemini Live with short-lived tokens issued by the API; report analysis also runs in the Next.js API. A separate backend host is unnecessary for this architecture.

## Accounts

| Service          | Purpose                             | Account / console                              |
| ---------------- | ----------------------------------- | ---------------------------------------------- |
| Vercel           | Next.js hosting                     | https://vercel.com/signup                      |
| Supabase         | Database, email login, Google login | https://supabase.com/dashboard                 |
| Google Cloud     | OAuth client for Google login       | https://console.cloud.google.com/auth/overview |
| Google AI Studio | Gemini API key and model access     | https://aistudio.google.com/                   |

Use existing accounts when available. Account passwords are not needed in source code or chat. Authenticate the Vercel CLI locally or connect the appropriate account/integration; configure service secrets in project settings.

## Supabase

1. Create or select the Supabase project.
2. Apply `supabase/migrations/001_speakbetter.sql` once in the SQL Editor or your migration workflow.
3. Collect the Project URL, publishable key, and server-only service-role key from the project settings.
4. Set Authentication → URL Configuration → Site URL to the final Vercel production origin.
5. Allow the exact `https://YOUR-PRODUCTION-HOST/auth/callback` redirect. For development, also allow `http://127.0.0.1:3000/auth/callback` and `http://localhost:3000/auth/callback` when used.

## Google login

1. In Google Cloud, create or select a project. Configure Google Auth Platform branding, audience, and data access for `openid`, email, and profile. Add test users if the consent screen remains in testing mode.
2. Create an OAuth client of type **Web application**.
3. Add the app's production origin to Authorized JavaScript origins. Include the local development origin when needed.
4. In Supabase → Authentication → Sign In / Providers → Google, copy the displayed callback URL. It normally has the form `https://PROJECT-REF.supabase.co/auth/v1/callback`.
5. Add that **Supabase callback** to Google's Authorized redirect URIs.
6. Save the Google Client ID and Client Secret in Supabase's Google provider settings, then enable the provider. Do not put the Google client secret in Vercel or a `NEXT_PUBLIC_` variable.
7. The app's **Continue with Google** button starts Supabase OAuth. Supabase redirects to the app's `/auth/callback`; the server exchanges the PKCE code for cookie-based authentication and opens onboarding for new users.

Google OAuth is independent of the Gemini API key. Configuring one does not configure the other.

## Vercel environment

Set these in the intended Vercel project and environment before building. Public values are included in the browser build; server credentials stay on the server.

| Variable                               | Value / handling                                                    |
| -------------------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase Project URL; public                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key; public                                    |
| `SUPABASE_SERVICE_ROLE_KEY`            | Supabase service-role key; server secret                            |
| `GEMINI_API_KEY`                       | Google AI Studio API key; server secret                             |
| `GEMINI_LIVE_MODEL`                    | Supported Live model for your account; see `.env.example`           |
| `GEMINI_REPORT_MODEL`                  | Supported analysis model for your account; see `.env.example`       |
| `GEMINI_REPORT_FALLBACK_MODEL`         | Optional backup analysis model; defaults to `gemini-3.5-flash-lite` |
| `NEXT_PUBLIC_SITE_URL`                 | Final HTTPS production origin                                       |

Select Node.js 24 in Vercel project settings. Framework preset: Next.js. Root directory: this repository root. Build command: `npm run build`. Install command: `npm ci`. Use the standard Next.js output; do not set an output directory to `dist` or run `build:sites`. API routes declare a 120-second maximum duration; ensure the project supports that duration.

## Deploy and verify

### Written chat and writing reviews

Apply `supabase/migrations/003_writing_chat.sql` once before serving the `/chat` feature. It creates private chat, message, request-lease, and review-progress tables. Browser roles cannot access these tables or service functions directly; authenticated API routes check ownership before server writes. Existing voice sessions and reports use their original storage.

`GEMINI_CHAT_MODEL` is optional and defaults to `gemini-3.5-flash-lite`, using the existing server `GEMINI_API_KEY`. The tutor opens the conversation and retains saved context for each reply. Each chat permits 30 learner messages, up to 5,000 characters each; starts are limited to ten per UTC day, message requests to twelve per minute, and review requests to six per hour. Retries reuse request IDs and database leases to prevent duplicate messages and stale replies.

Ending a chat preserves the conversation and reviews every learner message in batches of up to three (long messages are reviewed separately) with up to three workers. Each suggested correction must quote an exact substring from the corresponding learner message; IDs and complete message coverage are validated before saving. Completed batches are cached for retry. Real errors are highlighted; optional style suggestions are labeled separately. The review includes a full corrected version of each changed message and explanations, with no inferred speech metrics. AI feedback can still miss errors or misunderstand intended meaning.

For `tests/e2e/writing.spec.ts`, use a local app with dummy public Supabase values as described below and set `PLAYWRIGHT_WRITING_CONFIGURED=1`. The suite mocks authentication and AI responses while checking tutor-led opening, error highlights, saved-review refresh, duplicate-safe retry, mobile layout, and accessibility. Use a signed-in production browser for a real chat/review smoke test.

### Daily practice reminders

Apply `supabase/migrations/002_practice_reminders.sql` after the original migration. Generate a Web Push VAPID key pair once and keep it stable: changing the signing key requires browsers to subscribe again. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (the HTTPS app origin or a contact mailto URL), and a random `REMINDER_CRON_SECRET` to Vercel. The private key and scheduler secret are server-only secrets.

Save that same scheduler secret in Supabase Vault under `speakbetter_reminder_cron`, then run `supabase/schedule-practice-reminders.sql`. The SQL uses pg_cron and pg_net to call the authenticated Vercel dispatch endpoint only when reminders are due. Update its production URL when deploying another instance. Inspect Cron job runs and pg_net responses to diagnose delivery failures; never put the literal secret in a saved SQL query.

Settings defaults to **7:30 PM, Asia/Kolkata**. Each learner enables notifications through a browser permission prompt, can change the time and time zone, send a test, disconnect a browser, or turn reminders off. Push works with the tab closed when the browser/device allows background delivery; iPhone requires installing the app on the Home Screen. Signing out disconnects the current browser. Notifications contain a generic practice prompt, with no learning records or transcript content. Delivery retries for up to 15 minutes, with database claims preventing overlapping dispatches and a per-user daily completion marker. Device/network settings can delay or suppress a notification.

Browser test environments: the normal preview suite runs with the public Supabase variables unset, including the missing-credentials recovery tests. For `tests/e2e/reminders.spec.ts`, start the app with dummy public values (`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key`), then run that file with `PLAYWRIGHT_REMINDERS_CONFIGURED=1`. Bootstrap, subscriptions, and permission results are mocked; no real keys or notifications are used. Database scheduling tests run separately with PGlite through `npm test`.

Report generation makes at most three requests within a 100-second budget. It switches from an unavailable primary model to the backup immediately, allowing up to 50 seconds for backup analysis. Short, schema-constrained learner references are mapped back to transcript UUIDs and every quotation is verified before saving. Failed reports remain retryable, including ones that hit the old five-attempt cap; generation is limited to six requests per user per hour. Existing saved reports are returned without another model call. No database migration is needed for this update.

The practice page offers recent BBC News headlines in Technology, World, and Science, with source links, publication dates, and discussion questions. `/api/topics` refreshes the public feeds about every 15 minutes, excludes headlines older than 72 hours, and leaves ordinary practice available during feed outages. No news API key is needed.

For a Git-connected deployment, push this source to your Git provider and import that repository into Vercel. Alternatively, with Node 24 installed, authenticate and deploy the local source:

```sh
npx vercel login
npx vercel link
npx vercel --prod
```

Choose the intended team/project. `.vercel` is ignored, and `.vercelignore` excludes local credentials and Sites build output. After the production URL is known, confirm the Vercel site URL and both OAuth redirect settings, then redeploy if build-time variables changed.

Verify Google sign-in with a real account, refresh to confirm the session persists, complete onboarding, and run the manual voice checklist in `README.md`. Local automated tests verify setup failures and cancelled-login recovery, but cannot verify Google consent or provider configuration without real service access.

Official references: [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Google login with Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google), [Vercel CLI deployment](https://vercel.com/docs/cli/deploying-from-cli).

## Personal dictionary and translation

Apply `supabase/migrations/004_dictionary_long_messages.sql` after migration 003 before deploying this feature. It adds the private `personal_dictionary` table, a read policy for each owner, server-only writes, and the 5,000-character database message limit. No new API key is needed. `/dictionary` and the translator inside writing chats use the existing Gemini key. Successful lookups are saved per user and target language; normalized repeated searches reuse their saved result. Entries include the translation, a simple English meaning, and an English usage example. Users can search and remove their own entries. Translation accepts up to 6,000 characters and supports the languages listed in the selector.
