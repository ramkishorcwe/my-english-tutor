import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality, EndSensitivity, StartSensitivity } from '@google/genai';
import { z } from 'zod';
import { serverDb, adminDb } from '@/lib/supabase/server';
import { defaultProfile, profileSchema, sessionSchema, turnSchema, type Turn } from '@/lib/schema';
import { coachInstruction } from '@/lib/coach';
import { generateReport, ReportGenerationError } from '@/lib/reports';
export const runtime = 'nodejs';
export const maxDuration = 120;
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error)
    throw new HttpError('Database operation failed. Check the migration and try again.', 503);
  return result.data;
}
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path;
    const method = request.method;
    if (method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
      throw new HttpError('Request origin is not allowed.', 403);
    const db = await serverDb();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new HttpError('Sign in to continue.', 401);
    const admin = adminDb();
    if (method !== 'GET') {
      const allowed = checked(
        await admin.rpc('consume_usage', {
          p_user: user.id,
          p_action: path[0],
          p_limit: path.includes('turns') ? 120 : 30,
          p_seconds: 60,
        }),
      );
      if (!allowed) throw new HttpError('Too many requests. Try again in a minute.', 429);
    }
    let body: unknown = {};
    if (method === 'POST' || method === 'PATCH') {
      if (Number(request.headers.get('content-length') || 0) > 150000)
        throw new HttpError('Request is too large.', 413);
      const raw = await request.text();
      if (raw.length > 150000) throw new HttpError('Request is too large.', 413);
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError('Invalid JSON.');
      }
    }
    if (path[0] === 'bootstrap' && method === 'GET') {
      const [profile, sessions, exercises, vocabulary, reports] = await Promise.all([
        db.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        db.from('sessions').select('*').order('created_at', { ascending: false }).limit(100),
        db.from('exercises').select('*').order('created_at', { ascending: false }).limit(100),
        db.from('vocabulary').select('*').order('created_at', { ascending: false }).limit(100),
        db.from('reports').select('data').order('created_at', { ascending: false }).limit(100),
      ]);
      return json({
        user: { id: user.id, email: user.email },
        profile: checked(profile),
        sessions: checked(sessions),
        exercises: checked(exercises),
        vocabulary: checked(vocabulary),
        reports: checked(reports),
        voiceConfigured: Boolean(process.env.GEMINI_API_KEY),
      });
    }
    if (path[0] === 'profile' && method === 'POST') {
      const data = profileSchema.parse(body);
      checked(await db.from('profiles').upsert({ ...data, id: user.id }));
      return json({ ok: true });
    }
    if (path[0] === 'sessions' && path.length === 1 && method === 'POST') {
      if (!process.env.GEMINI_API_KEY)
        throw new HttpError(
          'Gemini is not configured. Add a server API key to enable voice practice.',
          503,
        );
      const data = sessionSchema.parse(body);
      const result = await admin.rpc('start_session', { p_user: user.id, p_data: data });
      if (result.error) throw new HttpError(result.error.message, 409);
      return json({ id: result.data });
    }
    if (path[0] === 'sessions' && path[1]) {
      const id = z.uuid().parse(path[1]);
      const session = checked(await db.from('sessions').select('*').eq('id', id).maybeSingle());
      if (!session) throw new HttpError('Session not found.', 404);
      if (path.length === 2 && method === 'GET') {
        const [turns, report] = await Promise.all([
          db
            .from('transcript_turns')
            .select('id,role,text,sequence')
            .eq('session_id', id)
            .order('sequence'),
          db.from('reports').select('data').eq('session_id', id).maybeSingle(),
        ]);
        return json({ session, turns: checked(turns), report: checked(report)?.data ?? null });
      }
      if (path.length === 2 && method === 'DELETE') {
        checked(await db.from('sessions').delete().eq('id', id));
        return json({ ok: true });
      }
      if (path[2] === 'turns' && method === 'POST') {
        const turns = z.array(turnSchema).max(50).parse(body);
        checked(await admin.rpc('save_turns', { p_user: user.id, p_session: id, p_turns: turns }));
        return json({ ok: true });
      }
      if (path[2] === 'token' && method === 'POST') {
        if (!process.env.GEMINI_API_KEY)
          throw new HttpError('Gemini voice credentials are missing.', 503);
        const remaining =
          new Date(session.created_at).getTime() + session.duration * 60000 - Date.now();
        if (session.status !== 'active' || remaining <= 0)
          throw new HttpError('Session time is up. End the session to get your report.', 409);
        const allowed = checked(
          await admin.rpc('consume_usage', {
            p_user: user.id,
            p_action: 'voice-token',
            p_limit: 8,
            p_seconds: 3600,
          }),
        );
        if (!allowed) throw new HttpError('Voice connection limit reached. Try again later.', 429);
        const profile = profileSchema.parse(
          checked(await db.from('profiles').select('*').eq('id', user.id).maybeSingle()) ??
            defaultProfile,
        );
        let memory = '';
        if (profile.memory_enabled) {
          const reports = checked(
            await db
              .from('reports')
              .select('data')
              .order('created_at', { ascending: false })
              .limit(4),
          );
          memory = JSON.stringify(
            (reports ?? []).map((r) => ({
              priorities: r.data.priorities,
              patterns: r.data.grammar?.map((g: { pattern?: string }) => g.pattern),
              vocabulary: r.data.vocabulary?.map((v: { phrase: string }) => v.phrase),
            })),
          ).slice(0, 5000);
        }
        const config = {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } } },
          systemInstruction: coachInstruction(profile, session.topic, session.difficulty, memory),
          sessionResumption: {},
          contextWindowCompression: { slidingWindow: {} },
          realtimeInputConfig: {
            automaticActivityDetection:
              session.input_mode === 'push-to-talk'
                ? { disabled: true }
                : {
                    disabled: false,
                    startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
                    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                    prefixPaddingMs: 300,
                    silenceDurationMs: 1600,
                  },
          },
        };
        const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: { apiVersion: 'v1beta' },
        });
        const token = await ai.authTokens.create({
          config: {
            uses: 1,
            expireTime: new Date(Date.now() + remaining).toISOString(),
            newSessionExpireTime: new Date(Date.now() + Math.min(60000, remaining)).toISOString(),
            liveConnectConstraints: { model, config },
          },
        });
        return json({
          token: token.name,
          model,
          config,
          expiresAt: new Date(Date.now() + remaining).toISOString(),
        });
      }
      if (path[2] === 'end' && method === 'POST') {
        checked(await admin.rpc('finish_session', { p_user: user.id, p_session: id }));
        return json({ ok: true });
      }
      if (path[2] === 'report' && method === 'POST') {
        if (session.status !== 'ended')
          throw new HttpError('End the conversation before generating a report.', 409);
        const existing = checked(
          await db.from('reports').select('data').eq('session_id', id).maybeSingle(),
        );
        if (existing) return json(existing.data);
        if (!process.env.GEMINI_API_KEY)
          throw new HttpError('Gemini report credentials are missing.', 503);
        const turns = checked(
          await db
            .from('transcript_turns')
            .select('id,role,text,sequence')
            .eq('session_id', id)
            .order('sequence'),
        ) as Turn[];
        if (!turns.some((t) => t.role === 'user'))
          throw new HttpError('No learner speech was captured. Start another conversation.', 422);
        const reportAllowed = checked(
          await admin.rpc('consume_usage', {
            p_user: user.id,
            p_action: 'report-generation',
            p_limit: 6,
            p_seconds: 3600,
          }),
        );
        if (!reportAllowed)
          throw new HttpError(
            'Summary retry limit reached for this hour. Your transcript is saved; please try again later.',
            429,
          );
        // Recover reports stranded by the old lifetime five-attempt cap. The hourly limit
        // above bounds provider use; only failed reports can reset, never an active lease.
        if (session.report_status === 'failed' && session.report_attempts >= 5)
          checked(
            await admin
              .from('sessions')
              .update({ report_attempts: 0 })
              .eq('id', id)
              .eq('user_id', user.id)
              .eq('report_status', 'failed')
              .eq('report_attempts', session.report_attempts),
          );
        const lease = checked(await admin.rpc('claim_report', { p_user: user.id, p_session: id }));
        if (!lease)
          throw new HttpError(
            'Your summary is already processing. Refresh in a few minutes, then retry if needed.',
            409,
          );
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const report = await generateReport(session.topic, turns, {
            model: process.env.GEMINI_REPORT_MODEL || 'gemini-3.6-flash',
            fallbackModel: process.env.GEMINI_REPORT_FALLBACK_MODEL,
            generate: (params) => ai.models.generateContent(params),
          });
          const committed = checked(
            await admin.rpc('commit_report', {
              p_user: user.id,
              p_session: id,
              p_lease: lease,
              p_report: report,
            }),
          );
          if (!committed) throw new HttpError('Report was superseded. Refresh the page.', 409);
          return json(report);
        } catch (error) {
          await admin
            .from('sessions')
            .update({ report_status: 'failed' })
            .eq('id', id)
            .eq('report_lease', lease);
          throw error;
        }
      }
    }
    if (['exercises', 'vocabulary'].includes(path[0]) && path[1] && method === 'PATCH') {
      const id = z.uuid().parse(path[1]);
      const data = z.object({ done: z.boolean() }).parse(body);
      checked(
        await admin
          .from(path[0])
          .update({ [path[0] === 'exercises' ? 'completed' : 'reviewed']: data.done })
          .eq('id', id)
          .eq('user_id', user.id),
      );
      return json({ ok: true });
    }
    if (path[0] === 'memory' && method === 'DELETE') {
      checked(await db.from('profiles').update({ memory_enabled: false }).eq('id', user.id));
      return json({ ok: true });
    }
    if (path[0] === 'account' && method === 'DELETE') {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw new HttpError('Account deletion failed. Please retry.', 503);
      await db.auth.signOut();
      return json({ ok: true });
    }
    throw new HttpError('Not found.', 404);
  } catch (error) {
    if (error instanceof ReportGenerationError) return json({ error: error.message }, error.status);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: 'Please check the submitted values.' }, 400);
    // Log metadata only: SDK errors may contain prompts, tokens, and transcripts.
    console.error('SpeakBetter request failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    const message =
      error instanceof Error &&
      /configured|credentials|ungrounded|transcript reference/.test(error.message)
        ? error.message
        : 'The service is temporarily unavailable. Check your connection and provider configuration, then retry.';
    return json({ error: message }, 503);
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
