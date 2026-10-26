import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveServerMessage } from '@google/genai';
const mock = vi.hoisted(() => ({
  connect: vi.fn(),
  send: vi.fn(),
  content: vi.fn(),
  close: vi.fn(),
  enqueue: vi.fn(),
  interrupt: vi.fn(),
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = { connect: mock.connect };
  },
}));
vi.mock('../src/lib/voice/audio', () => ({
  AudioPlayer: class {
    enqueue = mock.enqueue;
    interrupt = mock.interrupt;
  },
  base64PCM: () => 'AAAA',
}));
import { GeminiVoiceProvider } from '../src/lib/voice/gemini';

let callbacks: {
  onmessage: (m: Partial<LiveServerMessage>) => void;
  onclose: () => void;
  onerror: () => void;
};
let track: { stop: ReturnType<typeof vi.fn>; enabled: boolean; onended: null | (() => void) };
let contextClose: ReturnType<typeof vi.fn>;
let audioContext: {
  state: string;
  onstatechange: null | (() => void);
  resume: ReturnType<typeof vi.fn>;
};
let resumeContext: ReturnType<typeof vi.fn>;
let initialContextState: string;
let capturePort: {
  onmessage: null | ((event: { data: ArrayBuffer }) => void);
  close: ReturnType<typeof vi.fn>;
};
const events = () => ({
  onState: vi.fn(),
  onTurn: vi.fn(),
  onError: vi.fn(),
  onLevel: vi.fn(),
  onPlaybackBlocked: vi.fn(),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  track = { stop: vi.fn(), enabled: true, onended: null };
  contextClose = vi.fn();
  initialContextState = 'running';
  resumeContext = vi.fn().mockImplementation(async () => {
    audioContext.state = 'running';
    audioContext.onstatechange?.();
  });
  mock.connect.mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return { sendRealtimeInput: mock.send, sendClientContent: mock.content, close: mock.close };
  });
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }),
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      state = initialContextState;
      onstatechange: null | (() => void) = null;
      constructor() {
        audioContext = this;
      }
      audioWorklet = { addModule: vi.fn() };
      destination = {};
      resume = resumeContext;
      close = contextClose;
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
      createGain = () => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() });
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null, close: vi.fn() };
      constructor() {
        capturePort = this.port;
      }
      connect = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'short-lived-test-token',
        model: 'configured-test-model',
        config: { responseModalities: ['AUDIO'] },
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      }),
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Voice provider lifecycle', () => {
  it('keeps streaming hands-free audio across multiple coach replies without pressing the microphone again', async () => {
    const provider = new GeminiVoiceProvider('session', false, [], events());
    await provider.start();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({
      input_mode: 'hands-free',
    });
    capturePort.onmessage?.({ data: new ArrayBuffer(4) });
    callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
        turnComplete: true,
      },
    });
    capturePort.onmessage?.({ data: new ArrayBuffer(4) });
    callbacks.onmessage({ serverContent: { turnComplete: true } });
    capturePort.onmessage?.({ data: new ArrayBuffer(4) });
    expect(mock.send).toHaveBeenCalledTimes(3);
    expect(track.enabled).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    await provider.stop();
  });
  it('recovers suspended output without restarting the microphone or losing tutor audio', async () => {
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    await provider.start();
    audioContext.state = 'suspended';
    audioContext.onstatechange?.();
    expect(cb.onPlaybackBlocked).toHaveBeenLastCalledWith(true);
    callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    await provider.resumeAudio();
    expect(resumeContext).toHaveBeenCalledOnce();
    expect(cb.onPlaybackBlocked).toHaveBeenLastCalledWith(false);
    expect(mock.enqueue).toHaveBeenCalledWith('AAAA');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    await provider.stop();
  });
  it('a pending browser resume does not hang connection and the recovery action times out clearly', async () => {
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    initialContextState = 'suspended';
    resumeContext.mockImplementation(() => new Promise(() => {}));
    await provider.start();
    expect(mock.connect).toHaveBeenCalledOnce();
    const recovery = expect(provider.resumeAudio()).rejects.toThrow('Allow sound');
    await vi.advanceTimersByTimeAsync(2000);
    await recovery;
    expect(cb.onPlaybackBlocked).toHaveBeenLastCalledWith(true);
    await provider.stop();
  });
  it('explains microphone permission recovery and closes its audio context', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      new DOMException('Denied', 'NotAllowedError'),
    );
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    await provider.start();
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining('site permissions'));
    expect(cb.onState).toHaveBeenLastCalledWith('error');
    expect(contextClose).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('stops audio and ignores interrupted chunks from the same server event', async () => {
    const provider = new GeminiVoiceProvider('session', false, [], events());
    await provider.start();
    callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    expect(mock.enqueue).toHaveBeenCalledOnce();
    callbacks.onmessage({
      serverContent: {
        interrupted: true,
        modelTurn: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    expect(mock.interrupt).toHaveBeenCalled();
    expect(mock.enqueue).toHaveBeenCalledOnce();
    await provider.stop();
  });
  it('handles every audio part and incremental captions with stable IDs', async () => {
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    await provider.start();
    callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Yesterday I ' } } });
    callbacks.onmessage({
      serverContent: {
        inputTranscription: { text: 'went out.', finished: true },
        modelTurn: {
          parts: [
            { inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } },
            { inlineData: { data: 'AAAA', mimeType: 'audio/pcm;rate=24000' } },
          ],
        },
      },
    });
    expect(cb.onTurn.mock.calls[0][0].id).toBe(cb.onTurn.mock.calls[1][0].id);
    expect(cb.onTurn.mock.calls[1][0].text).toBe('Yesterday I went out.');
    expect(mock.enqueue).toHaveBeenCalledTimes(2);
    await provider.stop();
  });
  it('uses explicit activity boundaries in push-to-talk mode', async () => {
    const provider = new GeminiVoiceProvider('session', true, [], events());
    await provider.start();
    provider.setTalking(true);
    provider.setTalking(false);
    expect(mock.send).toHaveBeenNthCalledWith(1, { activityStart: {} });
    expect(mock.send).toHaveBeenNthCalledWith(2, { activityEnd: {} });
    expect(mock.interrupt).toHaveBeenCalled();
    await provider.stop();
  });
  it('flushes the audio stream on hands-free mute and disables the track', async () => {
    const provider = new GeminiVoiceProvider('session', false, [], events());
    await provider.start();
    provider.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(mock.send).toHaveBeenCalledWith({ audioStreamEnd: true });
    provider.setMuted(false);
    expect(track.enabled).toBe(true);
    await provider.stop();
  });
  it('resumes with the latest handle after GoAway and cancels retries on cleanup', async () => {
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    await provider.start();
    const oldCallbacks = callbacks;
    callbacks.onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: 'resume-handle' },
    });
    callbacks.onmessage({ goAway: { timeLeft: '60s' } });
    expect(cb.onState).toHaveBeenCalledWith('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(mock.connect.mock.calls[1][0].config.sessionResumption).toEqual({
      handle: 'resume-handle',
    });
    oldCallbacks.onclose();
    expect(cb.onState).toHaveBeenLastCalledWith('listening');
    callbacks.onclose();
    await provider.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mock.connect).toHaveBeenCalledTimes(2);
    expect(track.stop).toHaveBeenCalled();
    expect(contextClose).toHaveBeenCalled();
  });
  it('cleans up microphone and playback when token provisioning fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Gemini voice credentials are missing.' }),
    } as Response);
    const cb = events();
    const provider = new GeminiVoiceProvider('session', false, [], cb);
    await provider.start();
    expect(track.stop).toHaveBeenCalled();
    expect(mock.interrupt).toHaveBeenCalled();
    expect(cb.onError).toHaveBeenCalledWith('Gemini voice credentials are missing.');
  });
});
