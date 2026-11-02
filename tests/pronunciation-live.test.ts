import { afterEach, describe, it, expect, vi } from 'vitest';
import type { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { livePronunciationGeneration } from '../src/lib/pronunciation-live';
import { pronunciationWav } from '../src/lib/pronunciation-audio';
afterEach(() => vi.useRealTimers());
const parameters = () => ({
  model: 'test-live-model',
  contents: [
    {
      role: 'user',
      parts: [
        { text: '{"targetWord":"comfortable"}' },
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: Buffer.from(pronunciationWav(new Float32Array(16000))).toString('base64'),
          },
        },
      ],
    },
  ],
  config: { responseJsonSchema: { type: 'object' }, systemInstruction: 'Judge the recording.' },
});
describe('short realtime pronunciation assessment', () => {
  it('sends only PCM audio between activity boundaries and closes after the report', async () => {
    let message!: (value: Partial<LiveServerMessage>) => void;
    const close = vi.fn();
    const send = vi.fn().mockImplementation((input) => {
      if (input.activityEnd)
        queueMicrotask(() =>
          message({
            toolCall: {
              functionCalls: [{ name: 'report_pronunciation', args: { verdict: 'clear' } }],
            },
          }),
        );
    });
    const connect = vi.fn().mockImplementation(async (options) => {
      message = options.callbacks.onmessage;
      return { sendRealtimeInput: send, close };
    });
    const ai = { live: { connect } } as unknown as Pick<GoogleGenAI, 'live'>;
    const response = await livePronunciationGeneration(ai, parameters());
    expect(JSON.parse(response.text!)).toEqual({ verdict: 'clear' });
    expect(send.mock.calls[0][0]).toEqual({ activityStart: {} });
    expect(send.mock.calls[1][0].audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(Buffer.from(send.mock.calls[1][0].audio.data, 'base64')).toHaveLength(32000);
    expect(send.mock.calls[2][0]).toEqual({ activityEnd: {} });
    expect(close).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][0].config.systemInstruction).toContain('comfortable');
  });
  it('ignores unrelated tool calls and closes a session that produces no assessment', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const connect = vi.fn().mockImplementation(async (options) => {
      queueMicrotask(() =>
        options.callbacks.onmessage({
          toolCall: { functionCalls: [{ name: 'unrequested_action', args: {} }] },
        }),
      );
      return { sendRealtimeInput: vi.fn(), close };
    });
    const ai = { live: { connect } } as unknown as Pick<GoogleGenAI, 'live'>;
    const checked = expect(livePronunciationGeneration(ai, parameters())).rejects.toThrow(
      'too long',
    );
    await vi.advanceTimersByTimeAsync(20000);
    await checked;
    expect(close).toHaveBeenCalledOnce();
  });
});
