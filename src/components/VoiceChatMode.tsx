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
  ElevenLabsModelId,
  GEMINI_PREBUILT_VOICES,
  GeminiModelId,
  matchesWakeWord,
  NoizModelId,
  VoiceChatConfig,
  VoiceChatServerStatus,
  VoiceProvider,
} from '../lib/voiceChatConfig';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioUrl?: string;
  voiceEngine?: string;
}

function resampleFloatToInt16Base64(input: Float32Array, inputSampleRate: number): string {
  const targetRate = 16000;
  let samples: Int16Array;
  if (!inputSampleRate || Math.abs(inputSampleRate - targetRate) < 100) {
    samples = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const clamped = Math.max(-1, Math.min(1, input[i]));
      samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  } else {
    const ratio = inputSampleRate / targetRate;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    samples = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = input[idx] ?? 0;
      const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
      const val = s0 + (s1 - s0) * frac;
      const clamped = Math.max(-1, Math.min(1, val));
      samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  }
  const bytes = new Uint8Array(samples.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function formatVoiceEngineLabel(rawEngine: string | null): string {
  if (!rawEngine) return '';
  if (rawEngine === 'noiz') return 'Noiz.ai';
  if (rawEngine === 'elevenlabs') return 'ElevenLabs';
  if (rawEngine === 'gemini-tts') return 'Gemini';
  return rawEngine;
}

function extractCompletedSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let remaining = buffer;

  while (remaining.length > 0) {
    const match = remaining.match(/^([\s\S]*?[।?!\n]|[\s\S]{24,}?\.(?=\s|$))/);
    if (!match) break;
    const piece = match[1].replace(/\s+/g, ' ').trim();
    remaining = remaining.slice(match[1].length);
    if (piece) {
      sentences.push(piece);
    }
  }

  return { sentences, rest: remaining };
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
  const customName = config.assistantName.trim();
  const activeName = customName || 'ভয়েস সঙ্গী';
  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const [stage, setStage] = useState<VoiceStage>('idle');
  const [listenMode, setListenMode] = useState<'direct' | 'wake'>('direct');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftText, setDraftText] = useState('');
  const [statusNote, setStatusNote] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [liveUserTranscript, setLiveUserTranscript] = useState('');
  const [showQuickVoiceEditor, setShowQuickVoiceEditor] = useState(false);
  const [quickVoiceIdDraft, setQuickVoiceIdDraft] = useState('');
  const [quickSavedNote, setQuickSavedNote] = useState(false);

  const stageRef = useRef<VoiceStage>('idle');
  stageRef.current = stage;
  const listenModeRef = useRef<'direct' | 'wake'>(listenMode);
  listenModeRef.current = listenMode;
  const isMountedRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const configRef = useRef(config);
  configRef.current = config;

  const activeTurnIdRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const liveWsRef = useRef<WebSocket | null>(null);
  const liveConfirmedRef = useRef('');
  const liveInterimRef = useRef('');
  const vadRafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const wakeRecRef = useRef<SpeechRecognitionInstance | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveUserTranscript, stage]);

  const stopLiveTranscribeWs = useCallback(() => {
    if (scriptNodeRef.current) {
      try {
        scriptNodeRef.current.onaudioprocess = null;
        scriptNodeRef.current.disconnect();
      } catch {
        // Ignore disconnect error
      }
      scriptNodeRef.current = null;
    }
    if (liveWsRef.current) {
      try {
        liveWsRef.current.onmessage = null;
        liveWsRef.current.onerror = null;
        liveWsRef.current.onclose = null;
        if (
          liveWsRef.current.readyState === WebSocket.OPEN ||
          liveWsRef.current.readyState === WebSocket.CONNECTING
        ) {
          liveWsRef.current.close();
        }
      } catch {
        // Ignore close error
      }
      liveWsRef.current = null;
    }
  }, []);

  const stopRecordingResources = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    stopLiveTranscribeWs();
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
  }, [stopLiveTranscribeWs]);

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
    activeTurnIdRef.current += 1;
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
      activeTurnIdRef.current += 1;
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

  const fetchTtsAudioClip = useCallback(
    async (text: string): Promise<{ url: string; engineLabel: string }> => {
      const cfg = configRef.current;
      const provider = cfg.voiceProvider;
      const voiceId =
        provider === 'noiz'
          ? cfg.noizVoiceId
          : provider === 'gemini'
            ? cfg.geminiVoiceId
            : cfg.elevenLabsVoiceId;
      const modelId =
        provider === 'noiz'
          ? cfg.noizModelId
          : provider === 'gemini'
            ? cfg.geminiModelId
            : cfg.elevenLabsModelId;

      const res = await fetch('/api/voice-chat/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          provider,
          voiceId,
          modelId,
          voiceIds: {
            elevenlabs: cfg.elevenLabsVoiceId,
            noiz: cfg.noizVoiceId,
            gemini: cfg.geminiVoiceId,
          },
          modelIds: {
            elevenlabs: cfg.elevenLabsModelId,
            noiz: cfg.noizModelId,
            gemini: cfg.geminiModelId,
          },
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

      const engineLabel = formatVoiceEngineLabel(res.headers.get('X-Voice-Engine'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.push(url);
      return { url, engineLabel };
    },
    []
  );

  const playAudioUrlOnce = useCallback(
    async (url: string, turnId: number): Promise<void> => {
      if (!isMountedRef.current || activeTurnIdRef.current !== turnId) return;
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.src = '';
        ttsAudioRef.current = null;
      }
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
    },
    []
  );

  const speakBrowserFallback = useCallback(async (text: string, turnId: number): Promise<void> => {
    if (
      typeof window === 'undefined' ||
      !('speechSynthesis' in window) ||
      activeTurnIdRef.current !== turnId
    ) {
      return;
    }
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
  }, []);

  const playClonedVoice = useCallback(
    async (
      text: string,
      onFinished: () => void,
      onMetadata?: (info: { audioUrl?: string; voiceEngine?: string }) => void
    ): Promise<string | undefined> => {
      if (!isMountedRef.current) return undefined;
      const turnId = ++activeTurnIdRef.current;
      setStage('speaking');
      setStatusNote(`${activeName} কথা বলছে...`);

      const { sentences, rest } = extractCompletedSentences(text);
      const chunks = [...sentences, ...(rest.trim() ? [rest.trim()] : [])];
      const safeChunks = chunks.length > 0 ? chunks : [text];

      const pendingClips = safeChunks.map((chunk) =>
        fetchTtsAudioClip(chunk).then(
          (clip) => ({ ok: true as const, ...clip, chunk }),
          (err) => ({ ok: false as const, err, chunk })
        )
      );

      let firstUrl: string | undefined;
      try {
        for (const clipPromise of pendingClips) {
          if (!isMountedRef.current || activeTurnIdRef.current !== turnId) break;
          const res = await clipPromise;
          if (!isMountedRef.current || activeTurnIdRef.current !== turnId) break;

          if (res.ok) {
            if (!firstUrl) {
              firstUrl = res.url;
              onMetadata?.({ audioUrl: res.url, voiceEngine: res.engineLabel });
            }
            if (res.engineLabel) {
              setStatusNote(`${activeName} কথা বলছে (${res.engineLabel})...`);
            }
            await playAudioUrlOnce(res.url, turnId);
          } else {
            const msg =
              res.err instanceof Error ? res.err.message : 'ডিফল্ট ভয়েসে শোনানো হচ্ছে।';
            if (isMountedRef.current) {
              setErrorMsg(msg);
            }
            await speakBrowserFallback(res.chunk, turnId);
          }
        }
        return firstUrl;
      } finally {
        if (isMountedRef.current && activeTurnIdRef.current === turnId) {
          onFinished();
        }
      }
    },
    [activeName, fetchTtsAudioClip, playAudioUrlOnce, speakBrowserFallback]
  );

  const startWakeStandbyRef = useRef<() => void>(() => {});
  const startRecordingRef = useRef<() => void>(() => {});

  const resumeNextCycle = useCallback(() => {
    if (!isMountedRef.current) return;
    if (listenModeRef.current === 'wake' && speechSupported && configRef.current.assistantName.trim()) {
      startWakeStandbyRef.current();
    } else {
      setStage('idle');
      setStatusNote(
        configRef.current.assistantName.trim()
          ? `কথা বলতে মাইক চাপুন বা "${configRef.current.assistantName.trim()}" বলুন`
          : 'কথা বলতে মাইক বাটনে চাপুন বা নিচে লিখুন'
      );
    }
  }, [speechSupported]);

  const finishAssistantCycle = useCallback(
    (autoContinueListening?: boolean) => {
      if (!isMountedRef.current) return;
      if (autoContinueListening && listenModeRef.current === 'direct') {
        startRecordingRef.current();
      } else {
        resumeNextCycle();
      }
    },
    [resumeNextCycle]
  );

  const sendTextTurn = useCallback(
    async (userText: string, options?: { autoContinueListening?: boolean }) => {
      const clean = userText.trim();
      if (!clean || !isMountedRef.current) return;

      stopWakeListener();
      stopRecordingResources();
      setLiveUserTranscript('');
      setErrorMsg(null);
      const turnId = ++activeTurnIdRef.current;
      setStage('thinking');
      setStatusNote(`${activeName} ভাবছে...`);

      const history = messagesRef.current.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const msgId = `a_${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: `u_${Date.now()}`, role: 'user', text: clean },
        { id: msgId, role: 'assistant', text: '...' },
      ]);

      const clipPromises: Array<
        Promise<
          | { ok: true; url: string; engineLabel: string; chunk: string }
          | { ok: false; err: unknown; chunk: string }
        >
      > = [];
      let playbackStarted = false;
      let playbackChain: Promise<void> = Promise.resolve();
      let firstAudioUrl: string | undefined;
      let firstEngineLabel = '';

      const enqueueSentenceForTts = (sentenceText: string) => {
        const cleanSentence = sentenceText.trim();
        if (!cleanSentence || activeTurnIdRef.current !== turnId) return;
        const p = fetchTtsAudioClip(cleanSentence).then(
          (clip) => ({ ok: true as const, ...clip, chunk: cleanSentence }),
          (err) => ({ ok: false as const, err, chunk: cleanSentence })
        );
        clipPromises.push(p);

        playbackChain = playbackChain.then(async () => {
          if (!isMountedRef.current || activeTurnIdRef.current !== turnId) return;
          const res = await p;
          if (!isMountedRef.current || activeTurnIdRef.current !== turnId) return;
          if (!playbackStarted) {
            playbackStarted = true;
            setStage('speaking');
          }
          if (res.ok) {
            if (!firstAudioUrl) {
              firstAudioUrl = res.url;
              firstEngineLabel = res.engineLabel;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msgId
                    ? { ...m, audioUrl: res.url, voiceEngine: res.engineLabel }
                    : m
                )
              );
            }
            if (res.engineLabel) {
              setStatusNote(`${activeName} কথা বলছে (${res.engineLabel})...`);
            } else {
              setStatusNote(`${activeName} কথা বলছে...`);
            }
            await playAudioUrlOnce(res.url, turnId);
          } else {
            const msg =
              res.err instanceof Error ? res.err.message : 'ডিফল্ট ভয়েসে শোনানো হচ্ছে।';
            if (isMountedRef.current) setErrorMsg(msg);
            await speakBrowserFallback(res.chunk, turnId);
          }
        });
      };

      try {
        const res = await fetch('/api/voice-chat/respond-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textMessage: clean,
            assistantName: configRef.current.assistantName.trim(),
            personaNote: configRef.current.personaNote,
            history,
          }),
        });

        if (!res.ok || !res.body) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || 'উত্তর তৈরি করা যায়নি।');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let unparsedSpeechBuffer = '';
        let lastFullText = '';
        let finalReply = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!isMountedRef.current || activeTurnIdRef.current !== turnId) {
            await reader.cancel().catch(() => undefined);
            return;
          }

          sseBuffer += decoder.decode(value, { stream: true });
          const frames = sseBuffer.split('\n\n');
          sseBuffer = frames.pop() ?? '';

          for (const frame of frames) {
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            const jsonRaw = dataLine.slice(5).trim();
            if (!jsonRaw) continue;
            let ev: {
              delta?: string;
              fullText?: string;
              done?: boolean;
              reply?: string;
              error?: string;
            } = {};
            try {
              ev = JSON.parse(jsonRaw) as typeof ev;
            } catch {
              continue;
            }
            if (ev.error) {
              throw new Error(ev.error);
            }
            if (ev.delta) {
              unparsedSpeechBuffer += ev.delta;
              const { sentences, rest } = extractCompletedSentences(unparsedSpeechBuffer);
              unparsedSpeechBuffer = rest;
              for (const s of sentences) {
                enqueueSentenceForTts(s);
              }
            }
            if (ev.fullText) {
              lastFullText = ev.fullText;
              setMessages((prev) =>
                prev.map((m) => (m.id === msgId ? { ...m, text: ev.fullText! } : m))
              );
            }
            if (ev.done && ev.reply) {
              finalReply = ev.reply;
            }
          }
        }

        if (!isMountedRef.current || activeTurnIdRef.current !== turnId) return;

        const resolvedReply = (finalReply || lastFullText).trim();
        if (!resolvedReply) {
          throw new Error('উত্তর তৈরি করা যায়নি।');
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  text: resolvedReply,
                  ...(firstAudioUrl ? { audioUrl: firstAudioUrl } : {}),
                  ...(firstEngineLabel ? { voiceEngine: firstEngineLabel } : {}),
                }
              : m
          )
        );

        const tail = unparsedSpeechBuffer.replace(/\s+/g, ' ').trim();
        if (tail) {
          enqueueSentenceForTts(tail);
        } else if (clipPromises.length === 0) {
          enqueueSentenceForTts(resolvedReply);
        }

        await playbackChain;
        if (isMountedRef.current && activeTurnIdRef.current === turnId) {
          finishAssistantCycle(options?.autoContinueListening);
        }
      } catch (err) {
        if (!isMountedRef.current || activeTurnIdRef.current !== turnId) return;
        setMessages((prev) => prev.filter((m) => !(m.id === msgId && m.text === '...')));
        setErrorMsg(err instanceof Error ? err.message : 'কথোপকথনে সমস্যা হয়েছে।');
        resumeNextCycle();
      }
    },
    [
      activeName,
      fetchTtsAudioClip,
      finishAssistantCycle,
      playAudioUrlOnce,
      resumeNextCycle,
      speakBrowserFallback,
      stopRecordingResources,
      stopWakeListener,
    ]
  );

  const sendAudioTurn = useCallback(
    async (blob: Blob) => {
      if (!isMountedRef.current) return;
      if (blob.size < 600) {
        resumeNextCycle();
        return;
      }

      setLiveUserTranscript('');
      setErrorMsg(null);
      setStage('thinking');
      setStatusNote(`${activeName} শুনছে ও ভাবছে...`);

      const history = messagesRef.current.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const metaJson = JSON.stringify({
        assistantName: configRef.current.assistantName.trim(),
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

        await playClonedVoice(
          data.reply,
          () => finishAssistantCycle(true),
          ({ audioUrl, voiceEngine }) => {
            if (!isMountedRef.current) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      ...(audioUrl ? { audioUrl } : {}),
                      ...(voiceEngine ? { voiceEngine } : {}),
                    }
                  : m
              )
            );
          }
        );
      } catch (err) {
        if (!isMountedRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : 'ভয়েস প্রসেস করা যায়নি।');
        resumeNextCycle();
      }
    },
    [activeName, finishAssistantCycle, playClonedVoice, resumeNextCycle]
  );

  const startRecordingTurn = useCallback(async () => {
    if (!isMountedRef.current) return;
    stopWakeListener();
    stopSpeakingAudio();
    stopRecordingResources();
    setErrorMsg(null);
    liveConfirmedRef.current = '';
    liveInterimRef.current = '';
    setLiveUserTranscript('');

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
          channelCount: 1,
        },
      });
      if (!isMountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStreamRef.current = stream;
      chunksRef.current = [];

      // Open Gemini 3.5 Live real-time audio transcription WebSocket
      const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const liveWs = new WebSocket(`${wsProto}//${window.location.host}/api/voice-chat/live-transcribe`);
      liveWsRef.current = liveWs;
      let liveWsReady = false;
      const pendingAudioFrames: string[] = [];

      const updateCombinedLiveTranscript = () => {
        if (!isMountedRef.current) return;
        const combined = [liveConfirmedRef.current.trim(), liveInterimRef.current.trim()]
          .filter(Boolean)
          .join(' ')
          .trim();
        setLiveUserTranscript(combined);
      };

      liveWs.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const msg = JSON.parse(String(event.data || '{}')) as {
            ready?: boolean;
            interimTranscript?: string;
            transcript?: string;
          };
          if (msg.ready) {
            liveWsReady = true;
            while (pendingAudioFrames.length > 0 && liveWs.readyState === WebSocket.OPEN) {
              const b64 = pendingAudioFrames.shift();
              if (b64) liveWs.send(JSON.stringify({ audio: b64 }));
            }
          }
          if (typeof msg.interimTranscript === 'string') {
            liveInterimRef.current = msg.interimTranscript;
            updateCombinedLiveTranscript();
          }
          if (typeof msg.transcript === 'string' && msg.transcript.trim()) {
            const incoming = msg.transcript.trim();
            liveConfirmedRef.current = liveConfirmedRef.current
              ? `${liveConfirmedRef.current} ${incoming}`
              : incoming;
            liveInterimRef.current = '';
            updateCombinedLiveTranscript();
          }
        } catch {
          // ignore malformed ws payload
        }
      };

      liveWs.onerror = () => {
        liveWsReady = false;
      };

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
      let finalizingTurn = false;

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
        if (scriptNodeRef.current) {
          try {
            scriptNodeRef.current.onaudioprocess = null;
            scriptNodeRef.current.disconnect();
          } catch {
            // ignore disconnect error
          }
          scriptNodeRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        setMicLevel(0);

        if (!shouldProcessOnStop || !isMountedRef.current) {
          stopLiveTranscribeWs();
          setLiveUserTranscript('');
          return;
        }

        const finalize = async () => {
          // Flush Gemini Live STT for any trailing syllable (~200ms max)
          if (liveWs.readyState === WebSocket.OPEN) {
            try {
              liveWs.send(JSON.stringify({ flush: true }));
            } catch {
              // ignore flush error
            }
            await new Promise((r) => window.setTimeout(r, 200));
          }
          stopLiveTranscribeWs();
          if (!isMountedRef.current) return;

          const fastTranscript = [liveConfirmedRef.current.trim(), liveInterimRef.current.trim()]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (fastTranscript.length >= 2) {
            void sendTextTurn(fastTranscript, { autoContinueListening: true });
            return;
          }

          const blob = new Blob(rawChunks, {
            type: recorder.mimeType || 'audio/webm',
          });
          void sendAudioTurn(blob);
        };

        void finalize();
      };

      // Setup RMS Voice Activity Detection + Live 16kHz PCM audio streaming to Gemini Live
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

        const processor = ctx.createScriptProcessor(4096, 1, 1);
        scriptNodeRef.current = processor;
        const silentGain = ctx.createGain();
        silentGain.gain.value = 0;
        srcNode.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(ctx.destination);

        processor.onaudioprocess = (ev) => {
          if (!isMountedRef.current || stageRef.current !== 'listening' || finalizingTurn) return;
          const pcmBase64 = resampleFloatToInt16Base64(
            ev.inputBuffer.getChannelData(0),
            ctx.sampleRate
          );
          if (liveWsReady && liveWs.readyState === WebSocket.OPEN) {
            liveWs.send(JSON.stringify({ audio: pcmBase64 }));
          } else if (liveWs.readyState === WebSocket.CONNECTING && pendingAudioFrames.length < 18) {
            pendingAudioFrames.push(pcmBase64);
          }
        };

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
          if (rms > 0.022) {
            heardSpeech = true;
            lastSpeechAt = now;
          }

          const hasLiveWords =
            liveConfirmedRef.current.trim().length > 0 || liveInterimRef.current.trim().length > 0;
          const silenceLimitMs = hasLiveWords ? 720 : 1150;

          if (
            !finalizingTurn &&
            ((heardSpeech && now - lastSpeechAt > silenceLimitMs && now - startedAt > 650) ||
              now - startedAt > 18000)
          ) {
            finalizingTurn = true;
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
      setStatusNote('শুনছি... কথা বলুন (সাথে সাথেই লেখা উঠবে)');
      recorder.start(250);

      (recorder as MediaRecorder & { __cancelSend?: () => void }).__cancelSend = () => {
        shouldProcessOnStop = false;
      };
    } catch {
      setErrorMsg('মাইক্রোফোনের অনুমতি পাওয়া যায়নি। ব্রাউজার থেকে Mic Allow করুন।');
      setStage('idle');
    }
  }, [
    sendAudioTurn,
    sendTextTurn,
    stopLiveTranscribeWs,
    stopRecordingResources,
    stopSpeakingAudio,
    stopWakeListener,
  ]);

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
    setStatusNote(
      configRef.current.assistantName.trim()
        ? `"${configRef.current.assistantName.trim()}" নামে ডাকলে কথা বলে উঠবে...`
        : 'ডাকনাম সেট করুন...'
    );

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

  // Sync quick Voice ID input whenever provider tab or config changes
  useEffect(() => {
    const activeVal =
      config.voiceProvider === 'noiz'
        ? config.noizVoiceId
        : config.voiceProvider === 'gemini'
          ? config.geminiVoiceId
          : config.elevenLabsVoiceId;
    setQuickVoiceIdDraft(activeVal);
  }, [config.voiceProvider, config.elevenLabsVoiceId, config.noizVoiceId, config.geminiVoiceId]);

  const handleQuickSelectProvider = (nextProvider: VoiceProvider) => {
    setErrorMsg(null);
    const updated: VoiceChatConfig = {
      ...config,
      voiceProvider: nextProvider,
    };
    onUpdateConfig?.(updated);
  };

  const handleSaveQuickVoiceId = (e: FormEvent) => {
    e.preventDefault();
    const clean = quickVoiceIdDraft.trim();
    const targetProvider = config.voiceProvider === 'default' ? 'elevenlabs' : config.voiceProvider;
    const updated: VoiceChatConfig = {
      ...config,
      ...(targetProvider === 'noiz'
        ? { noizVoiceId: clean }
        : targetProvider === 'gemini'
          ? { geminiVoiceId: clean }
          : { elevenLabsVoiceId: clean }),
    };
    onUpdateConfig?.(updated);
    setQuickSavedNote(true);
    window.setTimeout(() => setQuickSavedNote(false), 2000);
  };

  const handleQuickModelChange = (modelVal: string) => {
    const targetProvider = config.voiceProvider === 'default' ? 'elevenlabs' : config.voiceProvider;
    const updated: VoiceChatConfig = {
      ...config,
      ...(targetProvider === 'noiz'
        ? { noizModelId: modelVal as NoizModelId }
        : targetProvider === 'gemini'
          ? { geminiModelId: modelVal as GeminiModelId }
          : { elevenLabsModelId: modelVal as ElevenLabsModelId }),
    };
    onUpdateConfig?.(updated);
  };

  const handleToggleAppWakeStandby = () => {
    if (!speechSupported && !config.wakeWordStandby) {
      setErrorMsg('এই ব্রাউজারে নাম ধরে ডাকার (Speech Recognition) সুবিধা সাপোর্ট করছে না।');
      return;
    }
    if (!config.wakeWordStandby && !customName) {
      setErrorMsg('অটো-ভয়েস চালু করার আগে সেটিংস থেকে আপনার পছন্দের ডাকনাম লিখুন।');
      onOpenSettings();
      return;
    }
    setErrorMsg(null);
    onUpdateConfig?.({
      ...config,
      wakeWordStandby: !config.wakeWordStandby,
    });
  };

  const handleToggleListenMode = (nextMode: 'direct' | 'wake') => {
    if (nextMode === 'wake' && !customName) {
      setErrorMsg('ডাকনাম দিয়ে সাড়া চালু করতে আগে সেটিংস থেকে একটি নাম দিন।');
      onOpenSettings();
      return;
    }
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
    const { sentences, rest } = extractCompletedSentences(msg.text);
    const totalParts = sentences.length + (rest.trim() ? 1 : 0);
    if (msg.audioUrl && totalParts <= 1) {
      stopSpeakingAudio();
      const turnId = activeTurnIdRef.current;
      setStage('speaking');
      setStatusNote(`${activeName} কথা বলছে...`);
      const audio = new Audio(msg.audioUrl);
      ttsAudioRef.current = audio;
      audio.onended = () => {
        if (activeTurnIdRef.current === turnId) resumeNextCycle();
      };
      audio.onerror = () => {
        if (activeTurnIdRef.current === turnId) resumeNextCycle();
      };
      audio.play().catch(() => {
        if (activeTurnIdRef.current === turnId) resumeNextCycle();
      });
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
              ভয়েস চ্যাট মোড
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {config.voiceProvider === 'default'
                ? 'ডিফল্ট (অটো সুইচ · ElevenLabs / Noiz.ai / Gemini)'
                : config.voiceProvider === 'noiz'
                  ? config.noizVoiceId
                    ? `Noiz.ai · ${config.noizVoiceId.slice(0, 10)}`
                    : serverStatus?.defaultNoizIdPreview
                      ? `Noiz.ai · ডিফল্ট (${serverStatus.defaultNoizIdPreview})`
                      : 'Noiz.ai · Voice ID দিন'
                  : config.voiceProvider === 'gemini'
                    ? `Gemini · ${
                        config.geminiVoiceId ||
                        serverStatus?.defaultGeminiVoicePreview ||
                        'Puck'
                      }`
                    : config.elevenLabsVoiceId
                      ? `ElevenLabs · ${config.elevenLabsVoiceId.slice(0, 10)}`
                      : serverStatus?.defaultVoiceIdPreview
                        ? `ElevenLabs · ডিফল্ট (${serverStatus.defaultVoiceIdPreview})`
                        : 'ElevenLabs · Voice ID দিন'}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setShowQuickVoiceEditor((v) => !v)}
            title="ভয়েস ইঞ্জিন ও Voice ID পরিবর্তন করুন"
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showQuickVoiceEditor
                ? 'border-emerald-300/50 bg-emerald-400/20 text-emerald-100'
                : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/15 hover:text-white'
            }`}
          >
            <AudioLines className="h-3.5 w-3.5 text-emerald-300" />
            <span className="hidden sm:inline">ভয়েস আইডি</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            title="ভয়েস মডেল ও ডাকনাম সেটিংস"
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
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-between gap-2.5 px-4 py-3 sm:py-5">
        {/* Quick 4-Provider Switcher Bar (Always accessible in Voice Chat Mode) */}
        <div className="flex w-full flex-col gap-2">
          <div className="grid w-full grid-cols-4 gap-1 rounded-xl border border-white/12 bg-black/45 p-1">
            {(
              [
                { id: 'default', label: 'ডিফল্ট' },
                { id: 'elevenlabs', label: 'ElevenLabs' },
                { id: 'noiz', label: 'Noiz.ai' },
                { id: 'gemini', label: 'Gemini' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleQuickSelectProvider(opt.id)}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${
                  config.voiceProvider === opt.id
                    ? 'border border-emerald-300/45 bg-emerald-400/20 text-emerald-100 shadow-[0_0_10px_rgba(52,211,153,0.18)]'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {showQuickVoiceEditor && (
            <form
              onSubmit={handleSaveQuickVoiceId}
              className="space-y-2 rounded-xl border border-emerald-300/25 bg-black/60 p-3 backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-emerald-200">
                  {config.voiceProvider === 'noiz'
                    ? 'Noiz.ai Voice ID ও মডেল পরিবর্তন'
                    : config.voiceProvider === 'gemini'
                      ? 'Gemini Voice ID ও মডেল পরিবর্তন'
                      : config.voiceProvider === 'elevenlabs'
                        ? 'ElevenLabs Voice ID ও মডেল পরিবর্তন'
                        : 'ElevenLabs Voice ID (ডিফল্ট চেইনের প্রথম ইঞ্জিন)'}
                </span>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-[10.5px] text-sky-300 hover:underline"
                >
                  সব সেটিংস দেখুন
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  maxLength={80}
                  value={quickVoiceIdDraft}
                  onChange={(e) => setQuickVoiceIdDraft(e.target.value)}
                  placeholder={
                    config.voiceProvider === 'gemini'
                      ? 'Gemini Voice (যেমন: Puck, Kore, Charon...)'
                      : config.voiceProvider === 'noiz'
                        ? 'Noiz.ai Voice ID পেস্ট করুন...'
                        : 'ElevenLabs Voice ID পেস্ট করুন...'
                  }
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
                />
                <select
                  value={
                    config.voiceProvider === 'noiz'
                      ? config.noizModelId
                      : config.voiceProvider === 'gemini'
                        ? config.geminiModelId
                        : config.elevenLabsModelId
                  }
                  onChange={(e) => handleQuickModelChange(e.target.value)}
                  className="rounded-lg border border-white/15 bg-black/70 px-2.5 py-1.5 text-xs text-white focus:border-emerald-300/60 focus:outline-none"
                >
                  {config.voiceProvider === 'noiz' ? (
                    <>
                      <option value="noiz_multilingual_v1">Noiz Multilingual v1</option>
                      <option value="noiz_expressive_v1">Noiz Expressive v1</option>
                    </>
                  ) : config.voiceProvider === 'gemini' ? (
                    <>
                      <option value="gemini-3.8-flash-lite-tts">Gemini Flash Lite TTS</option>
                      <option value="gemini-3.8-flash-tts">Gemini Flash TTS</option>
                    </>
                  ) : (
                    <>
                      <option value="eleven_multilingual_v2">Multilingual v2</option>
                      <option value="eleven_flash_v2_5">Flash v2.5</option>
                      <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                    </>
                  )}
                </select>
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-emerald-300 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-200"
                >
                  সেভ করুন
                </button>
              </div>

              {config.voiceProvider === 'gemini' && (
                <div className="flex flex-wrap gap-1">
                  {GEMINI_PREBUILT_VOICES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setQuickVoiceIdDraft(v);
                        onUpdateConfig?.({ ...config, geminiVoiceId: v });
                      }}
                      className={`rounded-md border px-2 py-0.5 text-[10px] ${
                        config.geminiVoiceId.trim().toLowerCase() === v.toLowerCase()
                          ? 'border-violet-300/60 bg-violet-400/25 text-violet-100'
                          : 'border-white/10 bg-black/40 text-slate-400 hover:text-white'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}

              {quickSavedNote && (
                <p className="text-[11px] text-emerald-300">ভয়েস আইডি সংরক্ষণ করা হয়েছে।</p>
              )}
            </form>
          )}
        </div>

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
              <span>{customName ? `"${customName}" ডাকলে সাড়া` : 'নাম ডাকলে সাড়া'}</span>
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
                  {customName
                    ? `অ্যাপ খোলা থাকলে "${customName}" ডাকলেই অটো-ভয়েস`
                    : 'অ্যাপ খোলা থাকলে ডাকনামে অটো-ভয়েস'}
                </p>
                <p className="truncate text-[10.5px] text-slate-400">
                  {config.wakeWordStandby && customName
                    ? 'চালু আছে — গান ও আবহাওয়ার সাউন্ড বন্ধ হয়ে সরাসরি ভয়েস শুনবে'
                    : customName
                      ? `বন্ধ আছে — অন করলে "${customName}" ডাকামাত্রই ভয়েস চালু হবে`
                      : 'সেটিংস থেকে পছন্দের ডাকনাম দিলে এই সুবিধা চালু হবে'}
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
          {messages.length === 0 && !liveUserTranscript ? (
            <div className="flex h-full min-h-[110px] flex-col items-center justify-center text-center text-xs text-slate-400">
              <MicOff className="mb-1.5 h-4 w-4 text-slate-500" />
              <p>
                {customName
                  ? `"${customName}" এখন আপনার সাথে সরাসরি কথা বলার জন্য প্রস্তুত।`
                  : 'ভয়েস চ্যাট এখন আপনার সাথে সরাসরি কথা বলার জন্য প্রস্তুত।'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                কথা বলুন অথবা নিচে লিখে পাঠান।
              </p>
            </div>
          ) : (
            <>
              {messages.map((m) => (
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
                      <span>{m.role === 'user' ? 'আপনি' : customName || 'ভয়েস'}</span>
                      {m.role === 'assistant' && (
                        <div className="flex items-center gap-2">
                          {m.voiceEngine && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-emerald-200">
                              {m.voiceEngine}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleReplayMessage(m)}
                            title="আবার শুনুন"
                            className="inline-flex items-center gap-0.5 text-emerald-300 hover:text-emerald-200"
                          >
                            <Volume2 className="h-3 w-3" />
                            <span>শুনুন</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              ))}
              {stage === 'listening' && liveUserTranscript && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl border border-emerald-300/35 bg-emerald-500/15 px-3.5 py-2 text-xs leading-relaxed text-emerald-50">
                    <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-emerald-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                      <span>আপনি (শুনছি...)</span>
                    </div>
                    <p>{liveUserTranscript}</p>
                  </div>
                </div>
              )}
            </>
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
            placeholder={customName ? `লিখে ${customName}-কে কিছু বলুন...` : 'লিখে কিছু বলুন...'}
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
