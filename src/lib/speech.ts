'use client';
import { speechChunks } from './pronunciation';

export class TextSpeaker {
  private epoch = 0;
  private utterance?: SpeechSynthesisUtterance;
  private onState?: (speaking: boolean) => void;
  static supported() {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }
  stop() {
    this.epoch++;
    if (TextSpeaker.supported()) window.speechSynthesis.cancel();
    this.utterance = undefined;
    this.onState?.(false);
  }
  speak(
    text: string,
    slow: boolean,
    onState: (speaking: boolean) => void,
    onError: (message: string) => void,
  ) {
    this.stop();
    this.onState = onState;
    if (!TextSpeaker.supported()) {
      onError(
        'This browser does not offer text-to-speech. Try a browser with English speech voices.',
      );
      return;
    }
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const epoch = this.epoch;
    const synth = window.speechSynthesis;
    const voice = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang));
    const next = (index: number) => {
      if (epoch !== this.epoch) return;
      if (index >= chunks.length) {
        this.utterance = undefined;
        onState(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      this.utterance = utterance;
      utterance.lang = voice?.lang || 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = slow ? 0.7 : 0.95;
      utterance.onend = () => next(index + 1);
      utterance.onerror = (event) => {
        if (epoch !== this.epoch) return;
        this.utterance = undefined;
        onState(false);
        if (event.error === 'canceled' || event.error === 'interrupted') return;
        onError(
          'The pronunciation audio could not play. Check device volume, then tap Listen again.',
        );
      };
      onState(true);
      try {
        synth.resume();
        synth.speak(utterance);
      } catch {
        this.utterance = undefined;
        onState(false);
        onError('The pronunciation audio could not play. Tap Listen to try again.');
      }
    };
    next(0);
  }
}
