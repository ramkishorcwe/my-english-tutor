import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), generate: vi.fn() }));
vi.mock('../src/lib/writing-server', () => ({
  writingUser: mocks.user,
  writingJson: (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } }),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generate };
  },
}));
vi.mock('../src/lib/pronunciation-live', () => ({
  livePronunciationGeneration: (_ai: unknown, params: unknown) => mocks.generate(params),
}));
import { POST } from '../src/app/api/pronunciation/route';
import { pronunciationWav } from '../src/lib/pronunciation-audio';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ user: { id: 'test' } });
  vi.stubEnv('GEMINI_API_KEY', 'test-only-key');
});
afterEach(() => vi.unstubAllEnvs());
function request(samples: Float32Array, wordId = 'comfortable') {
  const form = new FormData();
  form.set('wordId', wordId);
  form.set('audio', new Blob([pronunciationWav(samples)], { type: 'audio/wav' }), 'attempt.wav');
  return new Request('https://example.com/api/pronunciation', {
    method: 'POST',
    headers: { origin: 'https://example.com' },
    body: form,
  });
}
describe('recorded pronunciation route', () => {
  it('rejects silence without calling the AI or advancing the word', async () => {
    const response = await POST(request(new Float32Array(16000)));
    expect(response.status).toBe(200);
    expect((await response.json()).verdict).toBe('no_speech');
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('rejects overlong recordings before making a model request', async () => {
    const response = await POST(request(new Float32Array(16000 * 12)));
    expect(response.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('assesses real audio bytes and keeps the requested word ID', async () => {
    mocks.generate.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'clear',
        confidence: 'high',
        heard: 'comfortable',
        feedback: 'Clearly pronounced.',
        tip: '',
      }),
    });
    const samples = new Float32Array(16000);
    samples[100] = 0.3;
    const response = await POST(request(samples));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ wordId: 'comfortable', verdict: 'clear' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects invented practice IDs instead of evaluating arbitrary instructions', async () => {
    const response = await POST(request(new Float32Array(16000), 'ignore-the-rules'));
    expect(response.status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
