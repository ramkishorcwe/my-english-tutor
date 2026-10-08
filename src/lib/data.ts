import type { Profile, Report, Turn } from './schema';
export type PracticeSession = {
  id: string;
  topic: string;
  mode: string;
  difficulty: string;
  duration: number;
  input_mode: 'hands-free' | 'push-to-talk';
  created_at: string;
  ended_at: string | null;
  status: 'active' | 'ended';
  report_status: 'pending' | 'generating' | 'ready' | 'failed';
};
export type Exercise = {
  id: string;
  session_id: string;
  type: string;
  prompt: string;
  answer: string;
  completed: boolean;
};
export type Vocabulary = {
  id: string;
  session_id: string;
  phrase: string;
  meaning: string;
  example: string;
  prompt: string;
  reviewed: boolean;
};
export type AppData = {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  sessions: PracticeSession[];
  exercises: Exercise[];
  vocabulary: Vocabulary[];
  voiceConfigured: boolean;
  reports?: { data: Report }[];
};
export const emptyData: AppData = {
  user: null,
  profile: null,
  sessions: [],
  exercises: [],
  vocabulary: [],
  voiceConfigured: false,
};
export const modes = [
  {
    id: 'free',
    name: 'Free conversation',
    description: 'Follow your curiosity. We’ll follow along.',
    icon: 'messages',
    color: 'mint',
    topic: 'An open conversation about my interests',
  },
  {
    id: 'daily',
    name: 'Everyday life',
    description: 'Small talk, big possibilities.',
    icon: 'coffee',
    color: 'peach',
    topic: 'My daily routine and weekend plans',
  },
  {
    id: 'work',
    name: 'At work',
    description: 'Find your voice in the workplace.',
    icon: 'briefcase',
    color: 'lavender',
    topic: 'Sharing an idea in a team meeting',
  },
  {
    id: 'travel',
    name: 'Out in the world',
    description: 'Feel at home, wherever you go.',
    icon: 'globe',
    color: 'blue',
    topic: 'Asking a local for recommendations while traveling',
  },
  {
    id: 'interview',
    name: 'Job interviews',
    description: 'Let your experience do the talking.',
    icon: 'user',
    color: 'peach',
    topic: 'An interview for my next job',
  },
  {
    id: 'story',
    name: 'Storytelling',
    description: 'Make your next story worth sharing.',
    icon: 'book',
    color: 'lavender',
    topic: 'A memorable experience from my life',
  },
  {
    id: 'presentation',
    name: 'Presentations',
    description: 'Share your ideas with clarity.',
    icon: 'presentation',
    color: 'blue',
    topic: 'Presenting an idea to a small audience',
  },
  {
    id: 'custom',
    name: 'Make it your own',
    description: 'Your topic. Your real-life scenario.',
    icon: 'sparkles',
    color: 'mint',
    topic: '',
  },
];
export const demoTurns: Turn[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    role: 'model',
    sequence: 0,
    text: 'I’m your AI English coach. What does a typical morning look like for you?',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    role: 'user',
    sequence: 1,
    text: 'Usually I wake up at seven. Yesterday I go to a new cafe before work. I ordered coffee and talked to the owner.',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    role: 'model',
    sequence: 2,
    text: 'What made you choose that cafe?',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    role: 'user',
    sequence: 3,
    text: 'My friend recommended it. The owner was friendly and the coffee was very good. I want to visit again this weekend.',
  },
];
export const demoReport: Report = {
  summary:
    'You described your morning routine and a visit to a new cafe, explaining why you enjoyed it and when you would return.',
  successes: ['Explained your routine clearly.', 'Connected a recommendation to your experience.'],
  strengths: [
    'Clear sequencing of everyday events.',
    'Used “recommended” and “ordered” accurately.',
  ],
  priorities: ['Use the past tense consistently when talking about yesterday.'],
  grammar: [
    {
      turnId: demoTurns[1].id,
      original: 'Yesterday I go to a new cafe before work.',
      pattern: 'past-tense',
      corrected: 'Yesterday I went to a new cafe before work.',
      explanation: '“Yesterday” places this event in the past. The past form of “go” is “went.”',
      example: 'Yesterday I went to the market after lunch.',
    },
  ],
  expressions: [
    {
      turnId: demoTurns[3].id,
      original: 'the coffee was very good',
      alternative: 'the coffee was excellent',
      kind: 'optional',
    },
  ],
  vocabulary: [
    {
      phrase: 'a regular spot',
      meaning: 'A place you visit often.',
      example: 'This cafe is becoming my regular spot.',
      prompt: 'Describe a place that is your regular spot.',
      turnId: demoTurns[3].id,
    },
    {
      phrase: 'word of mouth',
      meaning: 'Hearing about something through other people.',
      example: 'I found this cafe through word of mouth.',
      prompt: 'Tell someone about a place you discovered through word of mouth.',
      turnId: demoTurns[3].id,
    },
  ],
  exercises: [
    {
      type: 'fill-gap',
      prompt: 'Yesterday I ___ to a new cafe before work.',
      answer: 'went',
      turnId: demoTurns[1].id,
    },
    {
      type: 'say-again',
      prompt: 'Say your corrected sentence aloud using “went.”',
      answer: 'Yesterday I went to a new cafe before work.',
      turnId: demoTurns[1].id,
    },
    {
      type: 'follow-up',
      prompt: 'Where did you go last weekend? Use the past tense.',
      answer: 'Example: I went to a cafe with a friend.',
      turnId: demoTurns[1].id,
    },
  ],
  plan: 'Spend five minutes describing yesterday. Choose three places you went and say one sentence about each.',
  nextTopic: 'A weekend worth remembering',
};
export async function api<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please retry.');
  return data as T;
}
export const sessionMinutes = (s: PracticeSession) =>
  s.ended_at
    ? Math.max(
        0,
        Math.round((new Date(s.ended_at).getTime() - new Date(s.created_at).getTime()) / 60000),
      )
    : 0;
