import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Mic,
  MicOff,
  Power,
  Send,
  SlidersHorizontal,
  Square,
  Volume2,
  Ear,
} from 'lucide-react';
import {
  DEFAULT_ASSISTANT_NAME,
  matchesWakeWord,
  VoiceChatConfig,
  VoiceChatServerStatus,
} from '../lib/voiceChatConfig';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioUrl?: string;
}

type VoiceStage = 'idle' | 'wake_wait' | 'listening' | 'thinking' | 'speaking';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface VoiceChatModeProps {
  config: VoiceChatConfig;
  serverStatus: VoiceChatServerStatus | null;
  initialPrompt?: string | null;
  startedByWakeWord?: boolean;
  onConsumeInitialPrompt?: () => void;
  onConsumeWakeTrigger?: () => void;
  onUpdateConfig?: (next: VoiceChatConfig) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

export function VoiceChatMode({
  config,
  serverStatus,
  initialPrompt,
  startedByWakeWord = false,
  onConsumeInitialPrompt,
  onConsumeWakeTrigger,
  onUpdateConfig,
  onOpenSettings,
  onClose,
}: VoiceChatModeProps) {
  const activeName = config.assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const [stage, setStage] = useState<VoiceStage>('idle');
  const [listenMode, setListenMode] = useState<'direct' | 'wake'>('direct');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const stageRef = useRef<VoiceStage>('idle');
  stageRef.current = stage;
  const listenModeRef = useRef<'direct' | 'wake'>(listenMode);
  listenModeRef.current = listenMode;
  const isMountedRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const configRef = useRef(config);
  configRef.current = config;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, stage]);

  const stopRecordingResources = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore stop errors
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const stopWakeListener = useCallback(() => {
    if (wakeRecRef.current) {
      try {
        wakeRecRef.current.onend = null;
        wakeRecRef.current.onresult = null;
        wakeRecRef.current.onerror = null;
        wakeRecRef.current.stop();
      } catch {
        // Ignore stop error
      }
      wakeRecRef.current = null;
    }
  }, []);

  const stopSpeakingAudio = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = '';
      ttsAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speechSynthesis cancel errors
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const urls = objectUrlsRef.current;
    return () => {
      isMountedRef.current = false;
      stopWakeListener();
      stopRecordingResources();
      stopSpeakingAudio();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [stopWakeListener, stopRecordingResources, stopSpeakingAudio]);

  const playChime = useCallback(() => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
      window.setTimeout(() => ctx.close().catch(() => {}), 350);
    } catch {
      // Ignore chime errors
    }
  }, []);

  const playClonedVoice = useCallback(
    async (text: string, onFinished: () => void): Promise<string | undefined> => {
      if (!isMountedRef.current) return undefined;
      setStage('speaking');
      setStatusNote(`${activeName} কথা বলছে...`);

      try {
        const cfg = configRef.current;
        const provider = cfg.voiceProvider;
        const voiceId = provider === 'noiz' ? cfg.noizVoiceId : cfg.elevenLabsVoiceId;
        const modelId = provider === 'noiz' ? cfg.noizModelId : cfg.elevenLabsModelId;

        const res = await fetch('/api/voice-chat/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            provider,
            voiceId,
            modelId,
          }),
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error || 'ভয়েস অডিও পাওয়া যায়নি।');
        }

        const voiceNoteRaw = res.headers.get('X-Voice-Note');
        if (voiceNoteRaw && isMountedRef.current) {
          try {
            setErrorMsg(decodeURIComponent(voiceNoteRaw));
          } catch {
            // Ignore malformed header
          }
        }

        const blob = await res.blob();
        if (!isMountedRef.current) return undefined;
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);

        stopSpeakingAudio();
        const audio = new Audio(url);
        ttsAudioRef.current = audio;

        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });

        return url;
      } catch (err) {
        if (isMountedRef.current) {
          setErrorMsg(
            err instanceof Error ? err.message : 'ডিফল্ট ভয়েসে শোনানো হচ্ছে।'
          );
        }
        // Last-resort browser speech synthesis so voice is still audible if all TTS APIs hit quota
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          await new Promise<void>((resolve) => {
            try {
              window.speechSynthesis.cancel();
              const utter = new SpeechSynthesisUtterance(text);
              utter.lang = /[\u0980-\u09FF]/.test(text) ? 'bn-BD' : 'en-US';
              utter.rate = 0.98;
              utter.onend = () => resolve();
              utter.onerror = () => resolve();
              window.speechSynthesis.speak(utter);
            } catch {
              resolve();
            }
          });
        }
        return undefined;
      } finally {
        if (isMountedRef.current) {
          onFinished();
        }
      }
    },
    [activeName, stopSpeakingAudio]
  );

  const startWakeStandbyRef = useRef<() => void>(() => {});
  const startRecordingRef = useRef<() => void>(() => {});

  const resumeNextCycle = useCallback(() => {
    if (!isMountedRef.current) return;
    if (listenModeRef.current === 'wake' && speechSupported) {
      startWakeStandbyRef.current();
    } else {
      setStage('idle');
      setStatusNote(`কথা বলতে মাইক চাপুন বা "${activeName}" বলুন`);
    }
  }, [activeName, speechSupported]);

  const sendTextTurn = useCallback(
    async (userText: string) => {
      const clean = userText.trim();
      if (!clean || !isMountedRef.current) return;

      stopWakeListener();
      stopRecordingResources();
      setErrorMsg(null);
      setStage('thinking');
      setStatusNote(`${activeName} ভাবছে...`);

      const history = messagesRef.current.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((prev) => [
        ...prev,
        { id: `u_${Date.now()}`, role: 'user', text: clean },
      ]);

      try {
        const res = await fetch('/api/voice-chat/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textMessage: clean,
            assistantName: configRef.current.assistantName || DEFAULT_ASSISTANT_NAME,
            personaNote: configRef.current.personaNote,
            history,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          transcript?: string;
          reply?: string;
          error?: string;
        };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || 'উত্তর তৈরি করা যায়নি।');
        }
        if (!isMountedRef.current) return;

        const msgId = `a_${Date.now()}`;
        setMessages((prev) => [...prev, { id: msgId, role: 'assistant', text: data.reply! }]);

        const audioUrl = await playClonedVoice(data.reply, resumeNextCycle);
        if (audioUrl && isMountedRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, audioUrl } : m))
          );
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : 'কথোপকথনে সমস্যা হয়েছে।');
        resumeNextCycle();
      }
    },
    [activeName, playClonedVoice, resumeNextCycle, stopRecordingResources, stopWakeListener]
  );

  const sendAudioTurn = useCallback(
    async (blob: Blob) => {
      if (!isMountedRef.current) return;
      if (blob.size < 600) {
        resumeNextCycle();
        return;
      }

      setErrorMsg(null);
      setStage('thinking');
      setStatusNote(`${activeName} শুনছে ও ভাবছে...`);

      const history = messagesRef.current.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const metaJson = JSON.stringify({
        assistantName: configRef.current.assistantName || DEFAULT_ASSISTANT_NAME,
        personaNote: configRef.current.personaNote,
        history,
      });
      const metaBase64 = btoa(unescape(encodeURIComponent(metaJson)));

      try {
        const res = await fetch('/api/voice-chat/respond-audio', {
          method: 'POST',
          headers: {
            'Content-Type': blob.type || 'audio/webm',
            'x-voice-meta': metaBase64,
          },
          body: blob,
        });
        const data = (await res.json().catch(() => ({}))) as {
          transcript?: string;
          reply?: string;
          error?: string;
        };
        if (!res.ok || !data.reply) {
          throw new Error(data.error || 'ভয়েস বুঝতে সমস্যা হয়েছে।');
        }
        if (!isMountedRef.current) return;

        const userSpoken = data.transcript?.trim() || 'ভয়েস বার্তা';
        const msgId = `a_${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          { id: `u_${Date.now()}`, role: 'user', text: userSpoken },
          { id: msgId, role: 'assistant', text: data.reply! },
        ]);

        const audioUrl = await playClonedVoice(data.reply, () => {
          if (!isMountedRef.current) return;
          if (listenModeRef.current === 'direct') {
            startRecordingRef.current();
          } else {
            resumeNextCycle();
          }
        });
        if (audioUrl && isMountedRef.current) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, audioUrl } : m))
          );
        }
      } catch (err) {
        if (!isMountedRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : 'ভয়েস প্রসেস করা যায়নি।');
        resumeNextCycle();
      }
    },
    [activeName, playClonedVoice, resumeNextCycle]
  );

  const startRecordingTurn = useCallback(async () => {
    if (!isMountedRef.current) return;
    stopWakeListener();
    stopSpeakingAudio();
    stopRecordingResources();
    setErrorMsg(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('এই ব্রাউজারে মাইক্রোফোন রেকর্ড সাপোর্ট নেই। নিচে লিখে কথা বলতে পারেন।');
      setStage('idle');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStreamRef.current = stream;
      chunksRef.current = [];

      const mimeCandidate = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : '';

      const recorder = mimeCandidate
        ? new MediaRecorder(stream, { mimeType: mimeCandidate })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      let shouldProcessOnStop = true;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const rawChunks = chunksRef.current.slice();
        chunksRef.current = [];
        if (vadRafRef.current !== null) {
          cancelAnimationFrame(vadRafRef.current);
          vadRafRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        setMicLevel(0);

        if (!shouldProcessOnStop || !isMountedRef.current) return;
        const blob = new Blob(rawChunks, {
          type: recorder.mimeType || 'audio/webm',
        });
        void sendAudioTurn(blob);
      };

      // Setup lightweight RMS Voice Activity Detection so user doesn't have to tap Stop manually
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const srcNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        srcNode.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);

        const startedAt = performance.now();
        let heardSpeech = false;
        let lastSpeechAt = performance.now();

        const tick = () => {
          if (!isMountedRef.current || stageRef.current !== 'listening') return;
          analyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const norm = (buf[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / buf.length);
          const scaled = Math.min(1, rms * 5.2);
          setMicLevel(scaled);

          const now = performance.now();
          if (rms > 0.024) {
            heardSpeech = true;
            lastSpeechAt = now;
          }

          // Auto-finish turn after 1.55s silence following speech, or max 18s per turn
          if (
            (heardSpeech && now - lastSpeechAt > 1550 && now - startedAt > 900) ||
            now - startedAt > 18000
          ) {
            if (recorder.state === 'recording') {
              recorder.stop();
              return;
            }
          }
          vadRafRef.current = requestAnimationFrame(tick);
        };

        vadRafRef.current = requestAnimationFrame(tick);
      }

      setStage('listening');
      setStatusNote(`শুনছি... কথা বলুন (চুপ হলে নিজেই উত্তর দেবে)`);
      recorder.start(250);

      // Attach cancel flag helper for external manual abort
      (recorder as MediaRecorder & { __cancelSend?: () => void }).__cancelSend = () => {
        shouldProcessOnStop = false;
      };
    } catch {
      setErrorMsg('মাইক্রোফোনের অনুমতি পাওয়া যায়নি। ব্রাউজার থেকে Mic Allow করুন।');
      setStage('idle');
    }
  }, [sendAudioTurn, stopRecordingResources, stopSpeakingAudio, stopWakeListener]);

  startRecordingRef.current = () => {
    void startRecordingTurn();
  };

  const startWakeStandby = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || !isMountedRef.current) {
      setStage('idle');
      return;
    }

    stopRecordingResources();
    stopWakeListener();

    const rec = new Ctor();
    rec.lang = 'bn-BD';
    rec.continuous = true;
    rec.interimResults = true;
    wakeRecRef.current = rec;

    setStage('wake_wait');
    setStatusNote(`"${activeName}" নামে ডাকলে কথা বলে উঠবে...`);

    let triggered = false;
    rec.onresult = (event) => {
      if (triggered || !isMountedRef.current) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res?.[0]?.transcript || '';
        const match = matchesWakeWord(text, configRef.current.assistantName);
        if (match.matched) {
          triggered = true;
          stopWakeListener();
          playChime();
          if (res.isFinal && match.remainder.length >= 2) {
            void sendTextTurn(match.remainder);
          } else {
            void startRecordingTurn();
          }
          return;
        }
      }
    };

    rec.onerror = (ev) => {
      if (!isMountedRef.current) return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setErrorMsg('মাইক্রোফোন অনুমতি দেওয়া হয়নি। নিচে লিখে বা মাইক চেপে অনুমতি দিন।');
        setStage('idle');
      }
    };

    rec.onend = () => {
      if (
        isMountedRef.current &&
        !triggered &&
        stageRef.current === 'wake_wait' &&
        listenModeRef.current === 'wake'
      ) {
        window.setTimeout(() => {
          if (isMountedRef.current && stageRef.current === 'wake_wait') {
            startWakeStandbyRef.current();
          }
        }, 350);
      }
    };

    try {
      rec.start();
    } catch {
      setStage('idle');
    }
  }, [activeName, playChime, sendTextTurn, startRecordingTurn, stopRecordingResources, stopWakeListener]);

  startWakeStandbyRef.current = startWakeStandby;

  // Handle initial entry (either triggered by saying "সোহাগ" or clicking the "অন" button!)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isMountedRef.current) return;
      if (startedByWakeWord) {
        playChime();
        onConsumeWakeTrigger?.();
      }
      if (initialPrompt && initialPrompt.trim()) {
        const promptCopy = initialPrompt.trim();
        onConsumeInitialPrompt?.();
        void sendTextTurn(promptCopy);
      } else {
        void startRecordingTurn();
      }
    }, 180);
    return () => window.clearTimeout(timer);
    // Run once on mount when Voice Chat Mode turns ON
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleAppWakeStandby = () => {
    if (!speechSupported && !config.wakeWordStandby) {
      setErrorMsg('এই ব্রাউজারে নাম ধরে ডাকার (Speech Recognition) সুবিধা সাপোর্ট করছে না।');
      return;
    }
    setErrorMsg(null);
    onUpdateConfig?.({
      ...config,
      wakeWordStandby: !config.wakeWordStandby,
    });
  };

  const handleToggleListenMode = (nextMode: 'direct' | 'wake') => {
    setListenMode(nextMode);
    listenModeRef.current = nextMode;
    stopWakeListener();
    stopSpeakingAudio();
    if (mediaRecorderRef.current) {
      const recWithCancel = mediaRecorderRef.current as MediaRecorder & {
        __cancelSend?: () => void;
      };
      recWithCancel.__cancelSend?.();
    }
    stopRecordingResources();

    if (nextMode === 'wake' && speechSupported) {
      startWakeStandby();
    } else {
      void startRecordingTurn();
    }
  };

  const handleMainMicClick = () => {
    if (stage === 'listening') {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }
    if (stage === 'speaking') {
      stopSpeakingAudio();
      void startRecordingTurn();
      return;
    }
    if (stage === 'thinking') {
      return;
    }
    void startRecordingTurn();
  };

  const handleSendDraft = (e: FormEvent) => {
    e.preventDefault();
    if (!draftText.trim() || stage === 'thinking') return;
    const text = draftText.trim();
    setDraftText('');
    void sendTextTurn(text);
  };

  const handleReplayMessage = (msg: ChatMessage) => {
    if (msg.audioUrl) {
      stopSpeakingAudio();
      setStage('speaking');
      setStatusNote(`${activeName} কথা বলছে...`);
      const audio = new Audio(msg.audioUrl);
      ttsAudioRef.current = audio;
      audio.onended = () => resumeNextCycle();
      audio.onerror = () => resumeNextCycle();
      audio.play().catch(() => resumeNextCycle());
    } else {
      void playClonedVoice(msg.text, resumeNextCycle);
    }
  };

  const orbScaleClass =
    stage === 'listening'
      ? micLevel > 0.55
        ? 'scale-125'
        : micLevel > 0.25
          ? 'scale-110'
          : 'scale-105'
      : stage === 'speaking'
        ? 'scale-105'
        : 'scale-100';

  return (
    <div
      role="region"
      aria-label="পূর্ণাঙ্গ ভয়েস চ্যাট মোড"
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-[#040812] via-[#071022] to-[#04070f] text-slate-100"
    >
      {/* Ambient radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className={`absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[110px] transition-colors duration-700 ${
            stage === 'speaking'
              ? 'bg-amber-400/20'
              : stage === 'listening'
                ? 'bg-emerald-400/25'
                : stage === 'thinking'
                  ? 'bg-sky-400/20'
                  : 'bg-sky-500/10'
          }`}
        />
      </div>

      {/* Top Bar */}
      <header className="relative z-10 flex items-center justify-between gap-2 border-b border-white/10 px-3.5 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-300/35 bg-emerald-400/15 text-emerald-200">
            <AudioLines className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white">
              {activeName} · ভয়েস চ্যাট মোড
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {config.elevenLabsVoiceId
                ? `Voice ID: ${config.elevenLabsVoiceId.slice(0, 8)}...`
                : serverStatus?.defaultVoiceIdPreview
                  ? `ডিফল্ট ভয়েস (${serverStatus.defaultVoiceIdPreview})`
                  : 'সেটিংস থেকে Voice ID সেট করুন'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            title="ভয়েস মডেল ও নাম পরিবর্তন করুন"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/15 hover:text-white"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-sky-300" />
            <span className="hidden sm:inline">সেটিংস</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopWakeListener();
              stopRecordingResources();
              stopSpeakingAudio();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/35"
          >
            <Power className="h-3.5 w-3.5" />
            <span>বন্ধ করুন</span>
          </button>
        </div>
      </header>

      {/* Main Voice Stage + Transcript */}
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-between gap-3 px-4 py-4 sm:py-6">
        {/* Mode Switch */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-white/12 bg-black/40 p-1">
          <button
            type="button"
            onClick={() => handleToggleListenMode('direct')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              listenMode === 'direct'
                ? 'bg-emerald-400/20 text-emerald-100 border border-emerald-300/35'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>সরাসরি কথা</span>
          </button>

          {speechSupported && (
            <button
              type="button"
              onClick={() => handleToggleListenMode('wake')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                listenMode === 'wake'
                  ? 'bg-sky-400/20 text-sky-100 border border-sky-300/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Ear className="h-3.5 w-3.5" />
              <span>&ldquo;{activeName}&rdquo; ডাকলে সাড়া</span>
            </button>
          )}
        </div>

        {/* App-Wide Background Wake-Word On/Off Button */}
        {onUpdateConfig && (
          <button
            type="button"
            onClick={handleToggleAppWakeStandby}
            aria-pressed={config.wakeWordStandby}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-left transition-all ${
              config.wakeWordStandby
                ? 'border-emerald-300/45 bg-emerald-500/15 text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,0.14)] hover:bg-emerald-500/20'
                : 'border-white/12 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                  config.wakeWordStandby
                    ? 'border-emerald-300/45 bg-emerald-400/20 text-emerald-200'
                    : 'border-white/15 bg-black/40 text-slate-400'
                }`}
              >
                <Ear className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">
                  অ্যাপ খোলা থাকলে &ldquo;{activeName}&rdquo; ডাকলেই অটো-ভয়েস
                </p>
                <p className="truncate text-[10.5px] text-slate-400">
                  {config.wakeWordStandby
                    ? `চালু আছে — গান ও আবহাওয়ার সাউন্ড বন্ধ হয়ে সরাসরি ভয়েস শুনবে`
                    : `বন্ধ আছে — অন করলে "${activeName}" ডাকামাত্রই ভয়েস চালু হবে`}
                </p>
              </div>
            </div>

            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                config.wakeWordStandby
                  ? 'border-emerald-300/60 bg-emerald-400 text-slate-950'
                  : 'border-white/20 bg-black/50 text-slate-300'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  config.wakeWordStandby ? 'bg-slate-950' : 'bg-slate-500'
                }`}
              />
              <span>{config.wakeWordStandby ? 'অন' : 'অফ'}</span>
            </span>
          </button>
        )}

        {/* Interactive Central Voice Orb */}
        <div className="flex flex-col items-center gap-4 py-2">
          <button
            type="button"
            onClick={handleMainMicClick}
            disabled={stage === 'thinking'}
            aria-label={
              stage === 'listening'
                ? 'কথা পাঠানো শেষ করুন'
                : stage === 'speaking'
                  ? 'থামিয়ে আবার বলুন'
                  : 'কথা বলুন'
            }
            className={`relative flex h-32 w-32 items-center justify-center rounded-full border transition-all duration-150 sm:h-36 sm:w-36 ${orbScaleClass} ${
              stage === 'listening'
                ? 'border-emerald-300/70 bg-emerald-500/25 text-emerald-100 shadow-[0_0_55px_rgba(52,211,153,0.45)]'
                : stage === 'speaking'
                  ? 'border-amber-300/70 bg-amber-400/25 text-amber-100 shadow-[0_0_55px_rgba(251,191,36,0.42)]'
                  : stage === 'thinking'
                    ? 'border-sky-300/60 bg-sky-500/20 text-sky-100 shadow-[0_0_45px_rgba(56,189,248,0.35)] animate-pulse'
                    : stage === 'wake_wait'
                      ? 'border-sky-300/45 bg-sky-500/15 text-sky-100 shadow-[0_0_35px_rgba(56,189,248,0.22)]'
                      : 'border-white/25 bg-white/10 text-white hover:border-emerald-300/60 hover:bg-emerald-400/15'
            }`}
          >
            {stage === 'listening' ? (
              <Square className="h-9 w-9 fill-current" />
            ) : stage === 'speaking' ? (
              <Volume2 className="h-10 w-10 animate-pulse" />
            ) : stage === 'wake_wait' ? (
              <Ear className="h-10 w-10" />
            ) : stage === 'thinking' ? (
              <AudioLines className="h-10 w-10 animate-spin" />
            ) : (
              <Mic className="h-10 w-10" />
            )}
          </button>

          <div className="text-center">
            <p className="text-sm font-medium text-white">
              {statusNote || `কথা বলতে মাইক বাটনে ট্যাপ করুন`}
            </p>
            {stage === 'speaking' && (
              <p className="mt-1 text-[11px] text-amber-200/80">
                মাঝখানে কথা বলতে চাইলে গোল বাটনে ট্যাপ করুন
              </p>
            )}
          </div>
        </div>

        {/* Error / Setup Reminder */}
        {errorMsg && (
          <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-rose-400/35 bg-rose-950/45 px-3 py-2 text-xs text-rose-200">
            <span className="min-w-0 flex-1">{errorMsg}</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="shrink-0 rounded-lg border border-rose-300/35 bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500/40"
            >
              সেটিংস
            </button>
          </div>
        )}

        {/* Conversation Log */}
        <div className="w-full min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/35 p-3 space-y-2.5">
          {messages.length === 0 ? (
            <div className="flex h-full min-h-[110px] flex-col items-center justify-center text-center text-xs text-slate-400">
              <MicOff className="mb-1.5 h-4 w-4 text-slate-500" />
              <p>
                &ldquo;{activeName}&rdquo; এখন আপনার সাথে সরাসরি কথা বলার জন্য প্রস্তুত।
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                কথা বলুন অথবা নিচে লিখে পাঠান।
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-sky-500/25 text-sky-50 border border-sky-300/25'
                      : 'bg-white/10 text-slate-100 border border-white/12'
                  }`}
                >
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span>{m.role === 'user' ? 'আপনি' : activeName}</span>
                    {m.role === 'assistant' && (
                      <button
                        type="button"
                        onClick={() => handleReplayMessage(m)}
                        title="আবার শুনুন"
                        className="inline-flex items-center gap-0.5 text-emerald-300 hover:text-emerald-200"
                      >
                        <Volume2 className="h-3 w-3" />
                        <span>শুনুন</span>
                      </button>
                    )}
                  </div>
                  <p>{m.text}</p>
                </div>
              </div>
            ))
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Text Backup Input */}
        <form onSubmit={handleSendDraft} className="flex w-full items-center gap-2">
          <input
            type="text"
            maxLength={500}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={`লিখে ${activeName}-কে কিছু বলুন...`}
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draftText.trim() || stage === 'thinking'}
            aria-label="পাঠান"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-300 text-slate-950 transition-colors hover:bg-emerald-200 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
