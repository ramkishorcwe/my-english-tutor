import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { pronunciationWordIdSchema, pronunciationWords } from '@/lib/pronunciation';
import { assessPronunciation } from '@/lib/pronunciation-ai';
import { livePronunciationGeneration } from '@/lib/pronunciation-live';
import { inspectPronunciationWav } from '@/lib/pronunciation-audio';
import { WritingError } from '@/lib/writing-ai';
import { writingJson, writingUser } from '@/lib/writing-server';
export const maxDuration = 90;
const maxBytes = 1024 * 1024;

async function boundedForm(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes + 16000)
    throw new WritingError('Please record a shorter clip, up to 10 seconds.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new WritingError('Please record the word first.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes + 16000) {
      await reader.cancel();
      throw new WritingError('Please record a shorter clip, up to 10 seconds.', 413);
    }
    chunks.push(value);
  }
  const payload = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(payload.buffer, {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
  } catch {
    throw new WritingError('Please send a microphone recording.', 400);
  }
}
export async function POST(request: Request) {
  try {
    await writingUser(request, 'pronunciation-assessment', 20, 60);
    if (!process.env.GEMINI_API_KEY)
      throw new WritingError('The pronunciation coach is not configured yet.');
    const form = await boundedForm(request);
    const wordId = pronunciationWordIdSchema.parse(form.get('wordId'));
    const file = form.get('audio');
    if (!(file instanceof File) || file.size < 100 || file.size > maxBytes)
      throw new WritingError('Record a clear clip of up to 10 seconds, then try again.', 400);
    if (file.type !== 'audio/wav')
      throw new WritingError(
        'This recording format is not supported. Try recording in another browser.',
        415,
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let recording;
    try {
      recording = inspectPronunciationWav(bytes);
    } catch (error) {
      throw new WritingError((error as Error).message, 400);
    }
    if (recording.silent)
      return writingJson({
        wordId,
        verdict: 'no_speech',
        confidence: 'high',
        heard: '',
        feedback: 'No speech was captured in this recording. Please try the same word again.',
        tip: 'Check your microphone and speak close enough for a clear recording.',
      });
    const word = pronunciationWords.find((w) => w.id === wordId)!;
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { apiVersion: 'v1beta' },
    });
    const assessment = await assessPronunciation(
      word.word,
      Buffer.from(bytes).toString('base64'),
      'audio/wav',
      (p) => livePronunciationGeneration(ai, p),
    );
    return writingJson({ wordId, ...assessment });
  } catch (error) {
    if (error instanceof z.ZodError)
      return writingJson({ error: 'Choose a practice word and record it again.' }, 400);
    if (error instanceof WritingError)
      return writingJson(
        { error: error.status === 401 ? 'Sign in to practise pronunciation.' : error.message },
        error.status,
      );
    return writingJson(
      { error: 'The recording could not be checked. Please try the same word again.' },
      503,
    );
  }
}
