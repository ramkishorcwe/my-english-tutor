import type { Turn } from '@/lib/schema';
export type VoiceState =
  'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'error';
export interface VoiceCallbacks {
  onState: (state: VoiceState) => void;
  onTurn: (turn: Turn) => void;
  onError: (message: string) => void;
  onLevel: (value: number) => void;
}
export interface VoiceProvider {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setTalking: (talking: boolean) => void;
  sendText: (text: string) => void;
  replay: () => void;
  interrupt: () => void;
}
