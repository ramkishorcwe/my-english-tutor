# SpeakBetter

A responsive English speaking practice app built with Next.js 16, TypeScript, Tailwind CSS, Supabase, and Google Gemini Live. The default workspace is an explicitly labeled preview; it never simulates a successful real voice connection.

## Run locally

Use **Node.js 22 or newer** (Node 24 is recommended). The current Supabase SDK requires it.

```sh
npm ci
cp .env.example .env.local
# Fill in your Supabase and Gemini values.
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local`. Open <http://127.0.0.1:3000>. Without credentials you can explore the dashboard, sample report, exercises, and settings; sign-in and voice explain their setup requirements.

## Supabase setup

1. Create a Supabase project. Run `supabase/migrations/001_speakbetter.sql` once in the SQL Editor (or apply it with your Supabase migration workflow).
2. Enable Email authentication. The app uses email OTP magic links with PKCE and server-verified cookie authentication.
3. In Authentication → URL Configuration, set the Site URL and allow the exact callback URLs you use, e.g. `http://127.0.0.1:3000/auth/callback`, `http://localhost:3000/auth/callback`, and your production `https://…/auth/callback`. Start and finish sign-in in the same browser and hostname.
4. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the **server-only** `SUPABASE_SERVICE_ROLE_KEY`. Never expose the service role as a `NEXT_PUBLIC_` variable.
5. Configure production SMTP and Supabase Auth rate limits before opening public registration. The app relies on Supabase's sign-in abuse protection.

Google sign-in is also supported through Supabase's PKCE flow and the same `/auth/callback` route. Enable the Google provider in Supabase, create a Web OAuth client in Google Cloud, and store its Client ID and Client Secret in Supabase's provider settings. Add the Supabase callback URL to Google's authorized redirect URIs and the app's `/auth/callback` URL to Supabase's redirect allowlist. Google OAuth secrets do not belong in browser code or Vercel public variables. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete Vercel setup.

No storage bucket is created and audio recording retention is disabled. All learning tables enable RLS. Browser clients can read their own data, edit their own profile, and delete their own sessions. Session writes, quota counters, report leases, and report commits are restricted to server functions callable by the service role. The API authenticates the user and verifies session ownership before privileged work.

## Gemini setup

Create a Google AI Studio API key with access and quota for your configured models. Set `GEMINI_API_KEY` on the server. The browser receives only a constrained, single-session, short-lived token after authentication, ownership checks, and rate limiting.

Official documentation checked on **8 October 2026**:

- [Models](https://ai.google.dev/gemini-api/docs/models): defaults are `gemini-3.8-live` and `gemini-3.6-flash`; both are configurable. Confirm model availability for your account.
- [Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities): mono little-endian signed 16-bit PCM input at 16 kHz; output PCM at 24 kHz. AudioWorklet performs streaming resampling, including 44.1 kHz devices. All audio parts in each message are processed.
- [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens): `v1beta`, one use, one-minute new-session window, expiry at the app session deadline. Model, voice, coach instructions, and audio configuration are constrained server-side.
- [Session management](https://ai.google.dev/gemini-api/docs/live-api/session-management): connections last approximately ten minutes; without compression, audio-only sessions have a fifteen-minute limit. The app enables compression and resumption, handles GoAway, and attempts three reconnects with backoff. A fresh connection can restore saved transcript context; audio context is not recoverable after a tab reload.
- [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output): a separate server request produces JSON validated with Zod and checked for exact learner quotes and real transcript references before an atomic database commit.
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client): cookie clients, Proxy refresh, and server-side user verification.

The app deliberately allows a 1.6-second silence window with low end-of-speech sensitivity. Learners needing longer pauses can choose push-to-talk. Provider behavior still needs verification against your account and microphones.

## Architecture and behavior

- `src/lib/voice/provider.ts`: provider-independent voice contract.
- `src/lib/voice/gemini.ts`: Gemini connection, captions, resumption, voice controls, and resource cleanup.
- `public/pcm-worklet.js`, `src/lib/voice/audio.ts`: microphone conversion and scheduled playback. Interruptions stop and disconnect every queued source immediately.
- `src/app/api/[...path]/route.ts`: authenticated profile/session/learning API, constrained token issuance, report generation, deletion, and database-backed limits.
- `src/lib/schema.ts`: input/report validation and transcript evidence checks.
- `src/components/`: responsive application UI and live conversation.
- `supabase/migrations/001_speakbetter.sql`: tables, RLS, grants, daily quota, rate counters, transcript upserts, idempotent session ending, report leases, and atomic report/exercise/vocabulary persistence.

Transcript fragments sync every two seconds. Unsent fragments are also stored in this tab's `sessionStorage`, scoped to user and session, to recover from refresh or temporary network failures. Ending a session first flushes fragments, then marks the session ended. Failed saves retain the draft and expose retry. Successful endings and sign-out clear recovery data. The report page automatically generates a pending report; failures expose manual retry. A three-minute lease permits recovery from a terminated analysis request, with at most five attempts. Stale workers cannot overwrite a newer report.

Sessions last 3–20 minutes, with a 60-minute daily allocation per user (UTC day). One session can be active per user. Token issuance is limited to eight per hour; writes also have persistent request limits. Session deletion does not reset daily allocation in the final migration's usage ledger. Google API/project budgets and quotas should also be configured.

Past learning memory consists of recent report priorities and saved vocabulary. Users can disable it in Settings; deleting a session removes its learning context as well as its report, exercises, and vocabulary. Account deletion cascades all database records. Metrics and history currently summarize the latest 100 sessions/items. Practice time means elapsed session time, not measured learner speech time.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run dev
# In another terminal, against an app with no .env.local credentials:
npm run test:e2e
```

Unit/integration tests execute real PostgreSQL policies and functions in PGlite, validate report evidence, check microphone resampling and queue cancellation, and exercise failure recovery. Browser tests cover desktop/mobile navigation, reports, exercises, missing credentials, horizontal overflow, and WCAG accessibility audits. These tests do not replace real Supabase and Gemini acceptance testing.

The project uses webpack for predictable Windows builds. If a restricted execution sandbox blocks Next output files or browser subprocesses, run the checks from a normal terminal. A writable `TEMP` directory may also be required for Vitest.

## Manual voice acceptance checklist

- [ ] Configure real credentials; sign in by email; save preferences; refresh and confirm they persist.
- [ ] Complete a microphone conversation in desktop Chrome/Edge and phone Safari/Chrome. Confirm actual spoken input, streamed spoken output, and captions.
- [ ] In hands-free mode, pause while thinking. Verify the coach does not rush the learner. Test push-to-talk with pointer and keyboard, including moving focus while holding the key.
- [ ] Talk over the coach: verify current and queued audio stop immediately on the provider interruption event. Test the explicit pause control and replay.
- [ ] Deny microphone permission, read recovery instructions, allow permission in browser site settings, and retry. Unplug the microphone or make it busy in another application.
- [ ] Test mute/unmute, captions, slower speech, hints, explanations, and native-language rescue prompts.
- [ ] Disconnect/reconnect the network; verify reconnect state, backoff, resumption, clear terminal errors, and retained transcript. Test a session beyond ten minutes to exercise GoAway.
- [ ] Refresh during practice; reconnect and confirm saved transcript context survives. End while network is unavailable; recover and retry without losing drafts.
- [ ] End repeatedly and concurrently; confirm one ended record and one report. Verify every correction quotes a real learner turn. Confirm speaking/pronunciation metrics remain unavailable.
- [ ] Force analysis failure or quota exhaustion. Restore the provider and retry. Simulate a terminated request, wait three minutes, and verify lease recovery.
- [ ] Create two Supabase test users; verify API and direct database access cannot read/write/delete each other's sessions, turns, reports, phrases, or exercises.
- [ ] Delete one session and verify its learning records disappear. Disable memory and confirm it is excluded from future instructions. Delete a test account and verify all app records disappear.
- [ ] Reach daily quota and session deadline; verify limits. Leaving/reloading/deleting a session must not reset usage allocation.
- [ ] End or navigate away; confirm the browser microphone indicator clears and audio/WebSocket resources close.

## Deploy

**Preferred deployment: Vercel for the Next.js frontend and API routes, Supabase for PostgreSQL and authentication, and Gemini for voice and reports.** `vercel.json` selects the ordinary Next.js build; Sites' Worker adapter is not used on Vercel. Follow [DEPLOYMENT.md](./DEPLOYMENT.md). The previously published private Sites preview remains separate until a Vercel deployment is connected.

Deploy the Next.js repository to Vercel or a Node host supporting **Node 22+**, HTTPS, outbound Google/Supabase requests, and at least a 120-second route runtime for analysis. Run `npm ci`, `npm run build`, and `npm start`. Set all environment variables in your host's secret settings; public Supabase values must exist at build time. Set production Supabase callback allowlists and SMTP. Apply the migration before serving authenticated traffic. No app WebSocket server is required: browsers connect directly to Gemini using the issued token.

### Sites / Cloudflare Workers

The private Sites deployment is identified by `.openai/hosting.json`. `npm run build:sites` builds the existing Next.js app with the OpenNext Cloudflare adapter, bundles the Worker into `dist/server/index.js`, and copies browser assets to `dist/client`. The ordinary Node build and start commands remain available. `scripts/patch-opennext.mjs` embeds the generated Next 16.4 preview-props manifest omitted by OpenNext 1.20.9; it fails explicitly if the loader format changes. No Cloudflare database or storage resources are needed; Supabase owns persistence. The adapter currently treats Next.js Node Proxy support as experimental, so verify real authentication after supplying credentials.

For Sites publication, use the Sites source/publishing workflow to push the exact commit and upload the generated deployment archive. Keep Supabase public values available during the build, and store `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` only in the host's runtime secret settings. Set `NEXT_PUBLIC_SITE_URL` to the deployed HTTPS origin, allow its `/auth/callback` URL in Supabase, apply the SQL migration, then complete the manual checklist above. Without those settings the deployment intentionally remains a labeled preview with sign-in and voice setup messages.

## Credentials and remaining external verification

Real sign-in, deployed RLS, real microphone input/output, interruption behavior, supported voices, provider quota errors, and GoAway/resumption require your own Supabase and Gemini services. They cannot be claimed as verified without credentials. Pronunciation assessment is optional and is not integrated; a specialist audio-evidence service would be needed for reliable scoring. Exercises that ask you to speak are self-guided and clearly do not record or score audio. No unofficial language score is presented.
