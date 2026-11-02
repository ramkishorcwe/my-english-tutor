const sampleRate = 16000;
export function pronunciationWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  });
  return buffer;
}
export function inspectPronunciationWav(bytes: Uint8Array) {
  if (bytes.length < 100) throw new Error('The recording was empty.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  const dataLength = view.getUint32(40, true);
  if (
    text(0, 4) !== 'RIFF' ||
    text(8, 4) !== 'WAVE' ||
    text(12, 4) !== 'fmt ' ||
    text(36, 4) !== 'data' ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== sampleRate ||
    view.getUint32(28, true) !== sampleRate * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    dataLength !== bytes.length - 44 ||
    dataLength % 2 !== 0
  )
    throw new Error('Please record the word again using the pronunciation microphone.');
  if (dataLength > sampleRate * 2 * 11)
    throw new Error('Please record a clip of up to 10 seconds.');
  let silent = true;
  for (let offset = 44; offset < bytes.length; offset += 2)
    if (view.getInt16(offset, true) !== 0) {
      silent = false;
      break;
    }
  return { duration: dataLength / (sampleRate * 2), silent };
}
export async function preparePronunciationRecording(blob: Blob) {
  const context = new AudioContext();
  try {
    const input = await context.decodeAudioData(await blob.arrayBuffer());
    if (!input.length) throw new Error('The recording was empty.');
    const offline = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(Math.min(input.duration, 10) * sampleRate)),
      sampleRate,
    );
    const source = offline.createBufferSource();
    source.buffer = input;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return new Blob([pronunciationWav(rendered.getChannelData(0))], { type: 'audio/wav' });
  } finally {
    await context.close();
  }
}
