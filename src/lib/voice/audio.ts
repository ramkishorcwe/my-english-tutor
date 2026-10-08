export function base64PCM(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
export function decodePCM(encoded: string) {
  const raw = atob(encoded);
  const view = new DataView(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) view.setUint8(i, raw.charCodeAt(i));
  const samples = new Float32Array(Math.floor(raw.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}
export class AudioPlayer {
  private sources = new Set<AudioBufferSourceNode>();
  private next = 0;
  constructor(
    private context: AudioContext,
    private idle: () => void,
  ) {}
  enqueue(encoded: string) {
    const samples = decodePCM(encoded);
    const buffer = this.context.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (!this.sources.size) this.idle();
    };
    const start = Math.max(this.context.currentTime, this.next);
    source.start(start);
    this.next = start + buffer.duration;
    this.sources.add(source);
  }
  interrupt() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.next = this.context.currentTime;
  }
}
