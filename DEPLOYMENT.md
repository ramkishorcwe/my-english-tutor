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

| Variable                               | Value / handling                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase Project URL; public                                                                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key; public                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`            | Supabase service-role key; server secret                                                                     |
| `GEMINI_API_KEY`                       | Google AI Studio API key; server secret                                                                      |
| `GEMINI_LIVE_MODEL`                    | Supported Live model for your account; see `.env.example`                                                    |
| `GEMINI_REPORT_MODEL`                  | Supported analysis model for your account; see `.env.example`                                                |
| `GEMINI_REPORT_FALLBACK_MODEL`         | Optional backup analysis model; defaults to `gemini-3.8-flash` (or `gemini-3.6-flash` if the primary is 3.8) |
| `NEXT_PUBLIC_SITE_URL`                 | Final HTTPS production origin                                                                                |

Select Node.js 24 in Vercel project settings. Framework preset: Next.js. Root directory: this repository root. Build command: `npm run build`. Install command: `npm ci`. Use the standard Next.js output; do not set an output directory to `dist` or run `build:sites`. API routes declare a 120-second maximum duration; ensure the project supports that duration.

## Deploy and verify

Report generation makes at most three 25-second requests, retrying temporary provider failures and checking every learner quotation before saving. Failed reports remain retryable, including ones that hit the old five-attempt cap; generation is limited to six requests per user per hour. Existing saved reports are returned without another model call. No database migration is needed for this update.

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
