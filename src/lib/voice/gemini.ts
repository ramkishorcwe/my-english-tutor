'use client';
import {
  GoogleGenAI,
  type Session,
  type LiveServerMessage,
  type LiveConnectConfig,
} from '@google/genai';
import type { Turn } from '@/lib/schema';
import { AudioPlayer, base64PCM } from './audio';
import type { VoiceProvider, VoiceCallbacks } from './provider';

export class GeminiVoiceProvider implements VoiceProvider {
  private session?: Session;
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private silent?: GainNode;
  private player?: AudioPlayer;
  private closed = false;
  private muted = false;
  private talking = false;
  private reconnecting = false;
  private attempts = 0;
  private handle?: string;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private credentials?: {
    token: string;
    model: string;
    config: LiveConnectConfig;
    expiresAt: string;
  };
  private sequence: number;
  private draft: Partial<Record<'user' | 'model', Turn>> = {};
  private latestAudio: string[] = [];
  private currentAudio: string[] = [];
  private currentBytes = 0;
  private suppressOutput = false;
  private connectionEpoch = 0;
  constructor(
    private id: string,
    private pushToTalk: boolean,
    private existing: Turn[],
    private cb: VoiceCallbacks,
  ) {
    this.sequence = Math.max(-1, ...existing.map((t) => t.sequence)) + 1;
  }
  async start() {
    this.cb.onState('connecting');
    this.closed = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Microphone access requires HTTPS or localhost and a supported browser.');
      this.context = new AudioContext();
      this.context.onstatechange = () => this.playbackState();
      // A browser can leave resume() pending until another user gesture. Keep
      // connecting and expose the sound recovery control instead of hanging.
      void this.resumeAudio().catch(() => {});
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (this.closed) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream
        .getAudioTracks()
        .forEach(
          (t) =>
            (t.onended = () =>
              this.fail('Your microphone disconnected. Reconnect the device and try again.')),
        );
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      this.player = new AudioPlayer(this.context, () => {
        if (!this.closed && !this.reconnecting) this.cb.onState('listening');
      });
      this.node = new AudioWorkletNode(this.context, 'pcm-capture');
      this.source = this.context.createMediaStreamSource(this.stream);
      this.silent = this.context.createGain();
      this.silent.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.silent);
      this.silent.connect(this.context.destination);
      this.node.port.onmessage = (event) => {
        if (
          this.closed ||
          this.muted ||
          this.reconnecting ||
          !this.session ||
          (this.pushToTalk && !this.talking)
        )
          return;
        const data = event.data as ArrayBuffer;
        const view = new DataView(data);
        let sum = 0;
        for (let i = 0; i < data.byteLength; i += 2) sum += (view.getInt16(i, true) / 32768) ** 2;
        this.cb.onLevel(Math.min(1, Math.sqrt(sum / (data.byteLength / 2)) * 6));
        try {
          this.session.sendRealtimeInput({
            audio: { data: base64PCM(data), mimeType: 'audio/pcm;rate=16000' },
          });
        } catch {
          this.reconnect();
        }
      };
      const response = await fetch(`/api/sessions/${this.id}/token`, {
        method: 'POST',
        body: JSON.stringify({ input_mode: this.pushToTalk ? 'push-to-talk' : 'hands-free' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      this.credentials = data;
      if (this.closed) return;
      const remaining = new Date(data.expiresAt).getTime() - Date.now();
      this.deadlineTimer = setTimeout(
        () => this.fail('Practice time is complete. End your session to save the report.'),
        Math.max(0, remaining),
      );
      await this.connect();
    } catch (error) {
      if (!this.closed) {
        const name = error instanceof Error ? error.name : '';
        const message =
          name === 'NotAllowedError'
            ? 'Microphone permission was denied. Open your browser’s site permissions, allow the microphone, then choose Try again.'
            : name === 'NotFoundError'
              ? 'No microphone was found. Connect a microphone, then try again.'
              : name === 'NotReadableError'
                ? 'Your microphone is busy. Close other apps using it, then try again.'
                : error instanceof Error
                  ? error.message
                  : 'Could not connect to voice practice.';
        await this.stop();
        this.cb.onState('error');
        this.cb.onError(message);
      }
    }
  }
  private async connect() {
    if (!this.credentials || this.closed) return;
    const epoch = ++this.connectionEpoch;
    const ai = new GoogleGenAI({
      apiKey: this.credentials.token,
      httpOptions: { apiVersion: 'v1beta' },
    });
    const session = await ai.live.connect({
      model: this.credentials.model,
      config: {
        ...this.credentials.config,
        sessionResumption: this.handle ? { handle: this.handle } : {},
      },
      callbacks: {
        onmessage: (message) => {
          if (epoch === this.connectionEpoch) this.message(message);
        },
        onerror: () => {
          if (epoch === this.connectionEpoch) this.reconnect();
        },
        onclose: () => {
          if (!this.closed && epoch === this.connectionEpoch) this.reconnect();
        },
      },
    });
    if (this.closed || epoch !== this.connectionEpoch) {
      session.close();
      return;
    }
    this.session = session;
    this.reconnecting = false;
    this.cb.onState('listening');
    if (!this.handle) {
      if (this.existing.length) {
        session.sendClientContent({
          turns: this.existing.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
          turnComplete: false,
        });
      }
      session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: this.existing.length
                  ? 'Please continue our practice conversation.'
                  : 'Please begin this practice with a short introduction and one question.',
              },
            ],
          },
        ],
        turnComplete: true,
      });
    }
  }
  private addTranscript(role: 'user' | 'model', text: string) {
    if (!text) return;
    let turn = this.draft[role];
    if (!turn) {
      turn = { id: crypto.randomUUID(), role, text: '', sequence: this.sequence++ };
      this.draft[role] = turn;
    }
    turn.text += text;
    this.cb.onTurn({ ...turn });
  }
  private message(message: LiveServerMessage) {
    if (this.closed) return;
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle)
      this.handle = message.sessionResumptionUpdate.newHandle;
    if (message.goAway) {
      this.reconnect();
      return;
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      this.player?.interrupt();
      this.currentAudio = [];
      this.currentBytes = 0;
      delete this.draft.model;
      this.cb.onState('listening');
    }
    if (content.inputTranscription?.text) {
      this.suppressOutput = false;
      this.addTranscript('user', content.inputTranscription.text);
      this.cb.onState('thinking');
    }
    if (content.outputTranscription?.text)
      this.addTranscript('model', content.outputTranscription.text);
    if (content.inputTranscription?.finished) delete this.draft.user;
    if (content.outputTranscription?.finished) delete this.draft.model;
    if (!content.interrupted && !this.suppressOutput)
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          const data = part.inlineData.data;
          this.player?.enqueue(data);
          this.cb.onState('speaking');
          if (this.currentBytes < 8_000_000) {
            this.currentAudio.push(data);
            this.currentBytes += data.length;
          }
        }
      }
    if (content.turnComplete) {
      this.latestAudio = this.currentAudio;
      this.currentAudio = [];
      this.currentBytes = 0;
      this.draft = {};
      this.attempts = 0;
    }
  }
  private reconnect() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    this.connectionEpoch++;
    this.player?.interrupt();
    this.cb.onState('reconnecting');
    if (
      this.attempts >= 3 ||
      !this.credentials ||
      Date.now() >= new Date(this.credentials.expiresAt).getTime()
    ) {
      this.fail(
        'Voice disconnected. Your captured transcript is saved. Try reconnecting or end the session.',
      );
      return;
    }
    this.session?.close();
    this.session = undefined;
    this.retryTimer = setTimeout(
      async () => {
        if (this.closed) return;
        try {
          await this.connect();
        } catch {
          this.reconnecting = false;
          this.reconnect();
        }
      },
      Math.min(8000, 1000 * 2 ** this.attempts++),
    );
  }
  private fail(message: string) {
    if (this.closed) return;
    void this.stop().then(() => {
      this.cb.onState('error');
      this.cb.onError(message);
    });
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (muted && this.session) {
      if (this.pushToTalk && this.talking) {
        this.talking = false;
        this.session.sendRealtimeInput({ activityEnd: {} });
      } else if (!this.pushToTalk) this.session.sendRealtimeInput({ audioStreamEnd: true });
    }
  }
  setTalking(talking: boolean) {
    if (!this.pushToTalk || !this.session || this.muted || talking === this.talking) return;
    this.talking = talking;
    if (talking) {
      this.suppressOutput = false;
      this.player?.interrupt();
      this.session.sendRealtimeInput({ activityStart: {} });
      this.cb.onState('listening');
    } else {
      this.session.sendRealtimeInput({ activityEnd: {} });
      this.cb.onState('thinking');
    }
  }
  sendText(text: string) {
    if (!this.session || this.reconnecting) return;
    this.suppressOutput = false;
    this.player?.interrupt();
    this.session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
    this.cb.onState('thinking');
  }
  replay() {
    this.player?.interrupt();
    const audio = [...(this.currentAudio.length ? this.currentAudio : this.latestAudio)];
    void this.resumeAudio()
      .then(() => {
        if (this.closed) return;
        for (const data of audio) this.player?.enqueue(data);
        if (audio.length) this.cb.onState('speaking');
      })
      .catch(() => {});
  }
  private playbackState() {
    this.cb.onPlaybackBlocked?.(
      Boolean(this.context && !this.closed && this.context.state !== 'running'),
    );
  }
  async resumeAudio() {
    const context = this.context;
    if (!context || this.closed) return;
    this.playbackState();
    if (context.state === 'running') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Call resume synchronously from the button's user gesture.
      await Promise.race([
        context.resume(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Sound is still paused. Allow sound in this browser tab, then try again.',
                ),
              ),
            2000,
          );
        }),
      ]);
      if (!this.closed && (context.state as AudioContextState) !== 'running')
        throw new Error('Sound is still paused. Return to this tab and try again.');
    } finally {
      clearTimeout(timer);
      this.playbackState();
    }
  }
  interrupt() {
    this.suppressOutput = true;
    this.player?.interrupt();
    this.session?.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [
            {
              text: 'Please pause quietly until I speak again. I would like to continue speaking.',
            },
          ],
        },
      ],
      turnComplete: true,
    });
  }
  async stop() {
    this.closed = true;
    if (this.context) this.context.onstatechange = null;
    this.cb.onPlaybackBlocked?.(false);
    this.connectionEpoch++;
    clearTimeout(this.retryTimer);
    clearTimeout(this.deadlineTimer);
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.silent?.disconnect();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.player?.interrupt();
    this.session?.close();
    this.session = undefined;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.cb.onLevel(0);
    this.cb.onState('idle');
  }
}
