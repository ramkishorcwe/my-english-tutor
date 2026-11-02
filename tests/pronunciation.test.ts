import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  pronunciationWords,
  speechChunks,
  verifiedPronunciationResult,
} from '../src/lib/pronunciation';
import { pronunciationWav, inspectPronunciationWav } from '../src/lib/pronunciation-audio';
import { assessPronunciation } from '../src/lib/pronunciation-ai';
import { TextSpeaker } from '../src/lib/speech';
const clear = {
  verdict: 'clear' as const,
  confidence: 'high' as const,
  heard: 'comfortable',
  feedback: 'That word was clear.',
  tip: '',
};
afterEach(() => vi.unstubAllGlobals());
describe('pronunciation challenge evidence', () => {
  it('only accepts a confident audio assessment of the actual target word', () => {
    expect(verifiedPronunciationResult('comfortable', clear).verdict).toBe('clear');
    expect(verifiedPronunciationResult('queue', { ...clear, heard: 'cue' }).verdict).toBe('clear');
    expect(verifiedPronunciationResult('world', { ...clear, heard: 'word' }).verdict).toBe(
      'uncertain',
    );
    expect(
      verifiedPronunciationResult('comfortable', { ...clear, confidence: 'low' }).verdict,
    ).toBe('uncertain');
    expect(verifiedPronunciationResult('comfortable', { ...clear, heard: 'banana' }).verdict).toBe(
      'uncertain',
    );
    expect(
      verifiedPronunciationResult('comfortable', { ...clear, verdict: 'no_speech', heard: '' })
        .verdict,
    ).toBe('no_speech');
  });
  it('sends the audio and target together, and validates the assessment', async () => {
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(clear) });
    expect(await assessPronunciation('comfortable', 'test-audio', 'audio/wav', generate)).toEqual(
      clear,
    );
    expect(generate.mock.calls[0][0].contents[0].parts[1]).toEqual({
      inlineData: { mimeType: 'audio/wav', data: 'test-audio' },
    });
  });
  it('rejects malformed assessments and never upgrades them to a pass', async () => {
    const generate = vi.fn().mockResolvedValue({ text: '{"correct":true}' });
    await expect(
      assessPronunciation('comfortable', 'audio', 'audio/wav', generate),
    ).rejects.toThrow('reliably');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('has unique stable word identifiers for browser progress', () => {
    expect(new Set(pronunciationWords.map((w) => w.id)).size).toBe(pronunciationWords.length);
  });
});
describe('bounded microphone clips', () => {
  it('encodes mono 16kHz PCM and identifies digital silence', () => {
    const silent = new Uint8Array(pronunciationWav(new Float32Array(16000)));
    expect(inspectPronunciationWav(silent)).toEqual({ duration: 1, silent: true });
    const samples = new Float32Array(16000);
    samples[100] = 0.4;
    expect(inspectPronunciationWav(new Uint8Array(pronunciationWav(samples))).silent).toBe(false);
  });
  it('rejects clips beyond the duration cap and misleading WAV headers', () => {
    expect(() =>
      inspectPronunciationWav(new Uint8Array(pronunciationWav(new Float32Array(16000 * 12)))),
    ).toThrow('10 seconds');
    const invalid = new Uint8Array(pronunciationWav(new Float32Array(16000)));
    invalid[24] = 1;
    expect(() => inspectPronunciationWav(invalid)).toThrow('record the word again');
  });
});
describe('text pronunciation playback', () => {
  it('chunks long text without losing words', () => {
    const text = 'Please read this whole sentence clearly. '.repeat(80).trim();
    const chunks = speechChunks(text);
    expect(chunks.every((c) => c.length <= 180)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
    expect(speechChunks('   ')).toEqual([]);
  });
  it('plays every text chunk in order and ignores stale completion after stop', () => {
    const spoken: { text: string; onend?: () => void; rate: number }[] = [];
    class Utterance {
      onend?: () => void;
      onerror?: () => void;
      rate = 1;
      lang = '';
      constructor(public text: string) {}
    }
    const synth = {
      cancel: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [{ lang: 'en-US' }],
      speak: (value: Utterance) => spoken.push(value),
    };
    vi.stubGlobal('window', { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    const engine = new TextSpeaker(),
      state = vi.fn();
    const text = 'An example of reading a longer paragraph. '.repeat(20);
    engine.speak(text, true, state, vi.fn());
    let index = 0;
    while (index < spoken.length) {
      spoken[index++].onend?.();
    }
    expect(spoken.map((s) => s.text).join(' ')).toBe(text.trim());
    expect(spoken.every((s) => s.rate < 1)).toBe(true);
    expect(state).toHaveBeenLastCalledWith(false);
    engine.speak(text, false, state, vi.fn());
    const current = spoken.at(-1)!;
    const count = spoken.length;
    engine.stop();
    current.onend?.();
    expect(spoken).toHaveLength(count);
  });
});
