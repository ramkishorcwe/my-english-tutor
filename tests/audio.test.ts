import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { AudioPlayer, base64PCM, decodePCM } from '../src/lib/voice/audio';

describe('PCM audio pipeline', () => {
  it('encodes little-endian samples and decodes negative full scale', () => {
    const buffer = new ArrayBuffer(6);
    const view = new DataView(buffer);
    view.setInt16(0, -32768, true);
    view.setInt16(2, 0, true);
    view.setInt16(4, 16384, true);
    expect([...decodePCM(base64PCM(buffer))]).toEqual([-1, 0, 0.5]);
  });
  for (const sampleRate of [44100, 48000])
    it(`converts ${sampleRate} Hz to 16 kHz across arbitrary render blocks`, () => {
      const blocks: ArrayBuffer[] = [];
      let Processor: new () => { process: (inputs: Float32Array[][]) => boolean };
      class Base {
        port = { postMessage: (data: ArrayBuffer) => blocks.push(data) };
      }
      runInNewContext(readFileSync('public/pcm-worklet.js', 'utf8'), {
        AudioWorkletProcessor: Base,
        sampleRate,
        registerProcessor: (_name: string, ctor: typeof Processor) => {
          Processor = ctor;
        },
        Float32Array,
        DataView,
        ArrayBuffer,
        Math,
      });
      const processor = new Processor!();
      let count = 0;
      while (count < sampleRate) {
        const length = Math.min(128, sampleRate - count);
        processor.process([[new Float32Array(length).fill(0.5)]]);
        count += length;
      }
      expect(blocks.length).toBe(15);
      const first = new DataView(blocks[0]);
      expect(first.getInt16(0, true)).toBe(16384);
      expect(first.getInt16(2046, true)).toBe(16384);
    });
  it('stops every scheduled audio source immediately and resets the queue', () => {
    const sources: {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      onended: null | (() => void);
    }[] = [];
    const context = {
      currentTime: 10,
      destination: {},
      createBuffer: () => ({ copyToChannel: vi.fn(), duration: 1 }),
      createBufferSource: () => {
        const s = {
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
          connect: vi.fn(),
          onended: null,
        };
        sources.push(s);
        return s;
      },
    };
    const player = new AudioPlayer(context as unknown as AudioContext, vi.fn());
    const data = base64PCM(new ArrayBuffer(100));
    player.enqueue(data);
    player.enqueue(data);
    player.enqueue(data);
    expect(sources[2].start).toHaveBeenCalledWith(12);
    player.interrupt();
    for (const s of sources) {
      expect(s.stop).toHaveBeenCalledOnce();
      expect(s.disconnect).toHaveBeenCalledOnce();
      expect(s.onended).toBeNull();
    }
    player.enqueue(data);
    expect(sources[3].start).toHaveBeenCalledWith(10);
  });
});
