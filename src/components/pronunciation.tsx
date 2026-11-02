'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Mic, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { AppData } from '@/lib/data';
import { TextSpeaker } from '@/lib/speech';
import { preparePronunciationRecording } from '@/lib/pronunciation-audio';
import {
  pronunciationAssessmentSchema,
  pronunciationWords,
  verifiedPronunciationResult,
  type PronunciationAssessment,
} from '@/lib/pronunciation';

export function SpeakButton({
  text,
  label = 'Listen',
  slow = false,
}: {
  text: string;
  label?: string;
  slow?: boolean;
}) {
  const engine = useRef<TextSpeaker | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => engine.current?.stop(), []);
  return (
    <div className="speak-control">
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          if (speaking) {
            engine.current?.stop();
            return;
          }
          setError('');
          engine.current ??= new TextSpeaker();
          engine.current.speak(text, slow, setSpeaking, setError);
        }}
        disabled={!text.trim()}
      >
        {speaking ? <Square size={14} /> : <Volume2 size={16} />} {speaking ? 'Stop audio' : label}
      </button>
      {error && (
        <p className="writing-note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Phase = 'ready' | 'requesting' | 'recording' | 'checking' | 'passed';
export function PronunciationPage({ data }: { data: AppData }) {
  const [mode, setMode] = useState<'listen' | 'practice'>('listen');
  const [text, setText] = useState('');
  const [slow, setSlow] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [assessment, setAssessment] = useState<PronunciationAssessment | null>(null);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const speaker = useRef<TextSpeaker | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const phaseRef = useRef<Phase>('ready');
  const key = `speakbetter:pronunciation:v1:${data.user?.id || 'guest'}`;
  const word = pronunciationWords[index];
  function setStage(value: Phase) {
    phaseRef.current = value;
    setPhase(value);
  }
  function releaseMicrophone() {
    clearTimeout(recordingTimer.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  function cancelAttempt() {
    epoch.current++;
    controller.current?.abort();
    clearTimeout(nextTimer.current);
    clearTimeout(recordingTimer.current);
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.onstop = null;
      current.ondataavailable = null;
      if (current.state !== 'inactive') current.stop();
    }
    releaseMicrophone();
    speaker.current?.stop();
  }
  useEffect(() => {
    try {
      const value = Number(localStorage.getItem(key) || 0);
      if (Number.isInteger(value) && value >= 0 && value <= pronunciationWords.length)
        setIndex(value);
    } catch {
      /* Practice still works if local storage is unavailable. */
    }
    setLoaded(true);
    const hidden = () => {
      if (
        document.visibilityState === 'hidden' &&
        ['requesting', 'recording'].includes(phaseRef.current)
      ) {
        cancelAttempt();
        setStage('ready');
        setError('Recording paused when you left this tab. Try the same word again.');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      cancelAttempt();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [key]);
  function play(value: string, slowly: boolean) {
    setAudioError('');
    speaker.current ??= new TextSpeaker();
    speaker.current.speak(value, slowly, setSpeaking, setAudioError);
  }
  function changeMode(value: 'listen' | 'practice') {
    if (phaseRef.current === 'passed') {
      setIndex((value) => value + 1);
      setAttempts(0);
    }
    cancelAttempt();
    setStage('ready');
    setAssessment(null);
    setError('');
    setAudioError('');
    setMode(value);
  }
  async function check(blob: Blob, wordId: string, target: string, attempt: number) {
    if (attempt !== epoch.current) return;
    if (blob.size < 100) {
      setStage('ready');
      setError('The recording was empty. Please try the same word again.');
      return;
    }
    setStage('checking');
    const request = new AbortController();
    controller.current = request;
    try {
      const wav = await preparePronunciationRecording(blob);
      if (attempt !== epoch.current) return;
      const form = new FormData();
      form.set('wordId', wordId);
      form.set('audio', wav, 'pronunciation-recording.wav');
      const response = await fetch('/api/pronunciation', {
        method: 'POST',
        body: form,
        signal: request.signal,
      });
      const result = await response.json();
      if (attempt !== epoch.current) return;
      if (!response.ok)
        throw new Error(result.error || 'The pronunciation coach could not check this recording.');
      if (result.wordId !== wordId)
        throw new Error('The assessment did not match this word. Please try again.');
      const feedback = verifiedPronunciationResult(
        target,
        pronunciationAssessmentSchema.parse(result),
      );
      setAssessment(feedback);
      if (feedback.verdict === 'clear') {
        setStage('passed');
        const nextIndex = index + 1;
        try {
          localStorage.setItem(key, String(nextIndex));
        } catch {}
        nextTimer.current = setTimeout(() => {
          if (attempt !== epoch.current) return;
          setIndex(nextIndex);
          setAttempts(0);
          setAssessment(null);
          setStage('ready');
        }, 1800);
      } else {
        setStage('ready');
        play(target, true);
      }
    } catch (e) {
      if (attempt !== epoch.current || request.signal.aborted) return;
      setStage('ready');
      setError(e instanceof Error ? e.message : 'Please try the same word again.');
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }
  async function record() {
    if (!word || !data.user || phaseRef.current !== 'ready') return;
    setError('');
    setAudioError('');
    setAssessment(null);
    speaker.current?.stop();
    const attempt = ++epoch.current;
    setStage('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
        throw new Error(
          'This browser cannot record microphone audio. Try a current browser with microphone support.',
        );
      const mime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime)
        throw new Error(
          'This browser has no supported recording format. Try Chrome, Edge, or Safari.',
        );
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (attempt !== epoch.current) {
        input.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = input;
      const current = new MediaRecorder(input, { mimeType: mime });
      recorder.current = current;
      const chunks: Blob[] = [];
      current.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      current.onerror = () => {
        if (attempt !== epoch.current) return;
        cancelAttempt();
        setStage('ready');
        setError('The microphone recording failed. Try the same word again.');
      };
      current.onstop = () => {
        releaseMicrophone();
        recorder.current = null;
        if (attempt === epoch.current)
          void check(
            new Blob(chunks, { type: current.mimeType || mime }),
            word.id,
            word.word,
            attempt,
          );
      };
      current.start();
      setStage('recording');
      setAttempts((value) => value + 1);
      recordingTimer.current = setTimeout(() => {
        if (attempt === epoch.current && current.state !== 'inactive') current.stop();
      }, 10000);
    } catch (e) {
      if (attempt !== epoch.current) return;
      releaseMicrophone();
      setStage('ready');
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow the microphone in this site’s permissions, then try again.'
          : e instanceof Error
            ? e.message
            : 'The microphone could not start. Please try again.',
      );
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GIVE EVERY WORD A LITTLE CONFIDENCE</div>
          <h1>Pronunciation studio.</h1>
          <p>Hear it clearly. Say it yourself. Build confidence one word at a time.</p>
        </div>
      </div>
      <div className="pronunciation-modes" aria-label="Pronunciation mode">
        <button
          className={`button ${mode === 'listen' ? 'primary' : 'secondary'}`}
          aria-pressed={mode === 'listen'}
          onClick={() => changeMode('listen')}
        >
          <Volume2 size={18} />
          Listen to text
        </button>
        <button
          className={`button ${mode === 'practice' ? 'primary' : 'secondary'}`}
          aria-pressed={mode === 'practice'}
          onClick={() => changeMode('practice')}
        >
          <Mic size={18} />
          Practise hard words
        </button>
      </div>
      {mode === 'listen' ? (
        <section className="panel pronunciation-listen">
          <h2>A word, a sentence, or your own text.</h2>
          <p>
            Paste English text and hear it spoken aloud. Use slow playback to listen more closely.
          </p>
          <label>
            English word or text
            <textarea
              maxLength={5000}
              value={text}
              onChange={(e) => {
                speaker.current?.stop();
                setText(e.target.value);
              }}
              placeholder="Try ‘entrepreneur’, or paste a sentence you want to practise."
            />
          </label>
          <div className="pronunciation-listen-controls">
            <label className="pronunciation-slow">
              <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
              Speak slowly
            </label>
            <span>{text.length.toLocaleString('en-IN')}/5,000 characters</span>
          </div>
          <button
            className="button primary"
            disabled={!text.trim()}
            onClick={() => (speaking ? speaker.current?.stop() : play(text, slow))}
          >
            {speaking ? <Square size={16} /> : <Volume2 size={18} />}{' '}
            {speaking ? 'Stop reading' : 'Read aloud'}
          </button>
          {audioError && (
            <p className="alert" role="alert">
              {audioError}
            </p>
          )}
          <p className="writing-note">
            Playback uses your browser’s English speech voice. You can also listen to words and
            examples in <Link href="/dictionary">My dictionary</Link>.
          </p>
        </section>
      ) : (
        <section className="panel pronunciation-challenge" aria-label="Pronunciation challenge">
          {!loaded ? (
            <p role="status">Opening your pronunciation practice…</p>
          ) : !word ? (
            <div className="pronunciation-complete">
              <Check size={36} />
              <h2>You’ve practised every word!</h2>
              <p>
                All {pronunciationWords.length} words completed. Come back for another round
                whenever you like.
              </p>
              <button
                className="button primary"
                onClick={() => {
                  setIndex(0);
                  try {
                    localStorage.setItem(key, '0');
                  } catch {}
                }}
              >
                Practise again <RotateCcw size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="pronunciation-progress">
                <span>
                  Word {index + 1} of {pronunciationWords.length}
                </span>
                <span>{word.group}</span>
              </div>
              <progress
                value={index}
                max={pronunciationWords.length}
                aria-label="Words completed"
              />
              <h2 className="pronunciation-word">{word.word}</h2>
              <p className="pronunciation-meaning">{word.meaning}</p>
              <div className="pronunciation-model">
                <button
                  className="button secondary"
                  disabled={['recording', 'requesting', 'checking', 'passed'].includes(phase)}
                  onClick={() => play(word.word, false)}
                >
                  <Volume2 size={17} />
                  Listen to the word
                </button>
                <button
                  className="button secondary"
                  disabled={['recording', 'requesting', 'checking', 'passed'].includes(phase)}
                  onClick={() => play(word.word, true)}
                >
                  Listen slowly
                </button>
              </div>
              {audioError && (
                <p className="alert" role="alert">
                  {audioError}
                </p>
              )}
              {data.user ? (
                <>
                  <button
                    className={`button primary pronunciation-record ${phase === 'recording' ? 'recording' : ''}`}
                    disabled={['requesting', 'checking', 'passed'].includes(phase)}
                    onClick={() =>
                      phase === 'recording'
                        ? recorder.current?.state === 'recording' && recorder.current.stop()
                        : void record()
                    }
                  >
                    {phase === 'recording' ? <Square size={16} /> : <Mic size={18} />}{' '}
                    {phase === 'recording'
                      ? 'Stop & check pronunciation'
                      : phase === 'requesting'
                        ? 'Opening microphone…'
                        : phase === 'checking'
                          ? 'Listening to your recording…'
                          : phase === 'passed'
                            ? 'Clear pronunciation · Next word…'
                            : attempts
                              ? 'Try this word again'
                              : 'Record my pronunciation'}
                  </button>
                  <p className="pronunciation-state" role="status">
                    {phase === 'recording'
                      ? `Recording: say “${word.word}”, then stop. Recording ends after 10 seconds.`
                      : phase === 'checking'
                        ? 'Your microphone is off while your pronunciation is checked.'
                        : phase === 'passed'
                          ? 'Well done. Moving to the next word automatically.'
                          : 'Say the displayed word. A clear attempt unlocks the next word.'}
                  </p>
                  {assessment && (
                    <div
                      className={`pronunciation-feedback ${assessment.verdict === 'clear' ? 'clear' : ''}`}
                    >
                      <h3>
                        {assessment.verdict === 'clear'
                          ? 'That was clear!'
                          : assessment.verdict === 'no_speech'
                            ? 'Let’s hear your voice.'
                            : 'Listen, then try this word again.'}
                      </h3>
                      <p>{assessment.feedback}</p>
                      {assessment.heard && (
                        <p>
                          I heard: <strong>{assessment.heard}</strong>
                        </p>
                      )}
                      {assessment.tip && <p>{assessment.tip}</p>}
                      {assessment.verdict !== 'clear' && (
                        <p className="writing-note">
                          {speaking
                            ? 'Playing a slow demonstration…'
                            : 'Use Listen to the word to hear the demonstration again.'}
                        </p>
                      )}
                    </div>
                  )}
                  {error && (
                    <p className="alert" role="alert">
                      {error}
                    </p>
                  )}
                  <p className="writing-note">
                    Your short recording is sent to Google Gemini for feedback and is not saved by
                    SpeakBetter. AI listening can be imperfect; understandable accent differences
                    are welcome. Progress stays in this browser.
                  </p>
                </>
              ) : (
                <div className="pronunciation-signin">
                  <p>
                    Sign in to record attempts and get pronunciation feedback. You can listen to the
                    example first.
                  </p>
                  <Link className="button primary" href="/signin">
                    Sign in to practise <ArrowRight size={16} />
                  </Link>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
