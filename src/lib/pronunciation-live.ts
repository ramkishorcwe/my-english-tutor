import {
  Modality,
  type GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Session,
} from '@google/genai';
import { inspectPronunciationWav } from './pronunciation-audio';
import { WritingError } from './writing-ai';

function logConnectionFailure(stage: string, code?: number, reason = '') {
  // Record transport diagnostics without keys, audio, target words, or transcripts.
  const safeReason = reason
    .replace(/(?:https?|wss?):\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, '[redacted]')
    .slice(0, 240);
  console.warn('pronunciation_audio_connection', {
    stage,
    code,
    reason: safeReason,
    runtime: process.version,
  });
}

/** One short audio-only session. Only a validated report tool result is returned to the learner. */
export function livePronunciationGeneration(
  ai: Pick<GoogleGenAI, 'live'>,
  params: GenerateContentParameters,
): Promise<GenerateContentResponse> {
  const content = params.contents as {
    parts: { text?: string; inlineData?: { data: string; mimeType: string } }[];
  }[];
  const input = content[0]?.parts.find((part) => part.inlineData)?.inlineData;
  if (!input) return Promise.reject(new WritingError('Please record the word again.', 400));
  const wav = Buffer.from(input.data, 'base64');
  inspectPronunciationWav(wav);
  return new Promise((resolve, reject) => {
    let session: Session | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, assessment?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session?.close();
      if (error) reject(error);
      else resolve({ text: JSON.stringify(assessment) } as GenerateContentResponse);
    };
    timer = setTimeout(
      () =>
        finish(
          new WritingError(
            'The pronunciation coach took too long to respond. Try the same word again.',
          ),
        ),
      20000,
    );
    void ai.live
      .connect({
        model: params.model,
        config: {
          responseModalities: [Modality.AUDIO],
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
          systemInstruction: `${params.config?.systemInstruction || ''} The target and the entire recording are provided for one assessment. Target-word data: ${content[0].parts.find((part) => part.text)?.text || ''}. After hearing the recording, call report_pronunciation exactly once. Do not speak a demonstration before judging: report only through the tool.`,
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'report_pronunciation',
                  description: 'Report pronunciation feedback grounded in the actual recording.',
                  parametersJsonSchema: params.config?.responseJsonSchema,
                },
              ],
            },
          ],
        },
        callbacks: {
          onmessage: (message) => {
            for (const call of message.toolCall?.functionCalls || [])
              if (call.name === 'report_pronunciation') {
                finish(undefined, call.args);
                break;
              }
          },
          onerror: () => {
            logConnectionFailure('error');
            finish(
              new WritingError(
                'The pronunciation audio connection failed. Please try the same word again.',
              ),
            );
          },
          onclose: (event) => {
            if (settled) return;
            logConnectionFailure('closed', event.code, event.reason);
            finish(
              new WritingError(
                'The pronunciation audio connection closed. Please try the same word again.',
              ),
            );
          },
        },
      })
      .then((opened) => {
        if (settled) {
          opened.close();
          return;
        }
        session = opened;
        try {
          opened.sendRealtimeInput({ activityStart: {} });
          opened.sendRealtimeInput({
            audio: { data: wav.subarray(44).toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          });
          opened.sendRealtimeInput({ activityEnd: {} });
        } catch {
          finish(
            new WritingError('The recording could not be sent for assessment. Please try again.'),
          );
        }
      })
      .catch((error: unknown) => {
        logConnectionFailure(
          'connect',
          undefined,
          error instanceof Error ? error.message : 'unknown',
        );
        finish(new WritingError('The pronunciation coach could not connect. Please try again.'));
      });
  });
}
