import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mic,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_VOICE_CHAT_CONFIG,
  ElevenLabsModelId,
  GEMINI_PREBUILT_VOICES,
  GeminiModelId,
  NoizModelId,
  VoiceChatConfig,
  VoiceChatServerStatus,
  VoiceProvider,
} from '../lib/voiceChatConfig';

interface VoiceChatSettingsModalProps {
  isOpen: boolean;
  config: VoiceChatConfig;
  serverStatus: VoiceChatServerStatus | null;
  onSave: (next: VoiceChatConfig) => void;
  onClose: () => void;
  onOpenVoiceChat?: () => void;
}

function maskVoicePreview(id: string): string {
  const clean = id.trim();
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

export function VoiceChatSettingsModal({
  isOpen,
  config,
  serverStatus,
  onSave,
  onClose,
  onOpenVoiceChat,
}: VoiceChatSettingsModalProps) {
  const [assistantName, setAssistantName] = useState(config.assistantName);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>(config.voiceProvider);
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(config.elevenLabsVoiceId);
  const [elevenLabsModelId, setElevenLabsModelId] = useState<ElevenLabsModelId>(
    config.elevenLabsModelId
  );
  const [noizVoiceId, setNoizVoiceId] = useState(config.noizVoiceId);
  const [noizModelId, setNoizModelId] = useState<NoizModelId>(config.noizModelId);
  const [geminiVoiceId, setGeminiVoiceId] = useState(config.geminiVoiceId);
  const [geminiModelId, setGeminiModelId] = useState<GeminiModelId>(config.geminiModelId);
  const [personaNote, setPersonaNote] = useState(config.personaNote);
  const [wakeWordStandby, setWakeWordStandby] = useState(config.wakeWordStandby);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const wasOpenRef = useRef(false);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setAssistantName(config.assistantName);
      setVoiceProvider(config.voiceProvider);
      setElevenLabsVoiceId(config.elevenLabsVoiceId);
      setElevenLabsModelId(config.elevenLabsModelId);
      setNoizVoiceId(config.noizVoiceId);
      setNoizModelId(config.noizModelId);
      setGeminiVoiceId(config.geminiVoiceId);
      setGeminiModelId(config.geminiModelId);
      setPersonaNote(config.personaNote);
      setWakeWordStandby(config.wakeWordStandby);
      setSavedFeedback(false);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, config]);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const buildCurrentDraft = (): VoiceChatConfig => ({
    assistantName: assistantName.trim(),
    voiceProvider,
    elevenLabsVoiceId: elevenLabsVoiceId.trim(),
    elevenLabsModelId,
    noizVoiceId: noizVoiceId.trim(),
    noizModelId,
    geminiVoiceId: geminiVoiceId.trim(),
    geminiModelId,
    personaNote: personaNote.trim(),
    wakeWordStandby,
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const draft = buildCurrentDraft();
    onSave(draft);
    setSavedFeedback(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => setSavedFeedback(false), 3200);
  };

  const handleResetDefaults = () => {
    setAssistantName(DEFAULT_VOICE_CHAT_CONFIG.assistantName);
    setVoiceProvider(DEFAULT_VOICE_CHAT_CONFIG.voiceProvider);
    setElevenLabsVoiceId('');
    setElevenLabsModelId(DEFAULT_VOICE_CHAT_CONFIG.elevenLabsModelId);
    setNoizVoiceId('');
    setNoizModelId(DEFAULT_VOICE_CHAT_CONFIG.noizModelId);
    setGeminiVoiceId('');
    setGeminiModelId(DEFAULT_VOICE_CHAT_CONFIG.geminiModelId);
    setPersonaNote('');
    setWakeWordStandby(false);
    onSave({ ...DEFAULT_VOICE_CHAT_CONFIG });
    setSavedFeedback(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => setSavedFeedback(false), 3200);
  };

  const cleanName = assistantName.trim();
  const showElevenBlock = voiceProvider === 'elevenlabs' || voiceProvider === 'default';
  const showNoizBlock = voiceProvider === 'noiz' || voiceProvider === 'default';
  const showGeminiBlock = voiceProvider === 'gemini' || voiceProvider === 'default';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ভয়েস মডেল সেটিংস"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6"
    >
      <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-[#080e1a]/98 p-4 text-slate-100 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-200">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">ভয়েস মডেল ও ডাকনাম সেটিংস</h2>
              <p className="text-[11px] text-slate-400">
                ElevenLabs, Noiz.ai ও Gemini-এর আলাদা ভয়েস আইডি ও মডেল এখান থেকে সেভ করুন
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="বন্ধ করুন"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Wake Name / Assistant Name */}
          <div>
            <label
              htmlFor="voice-assistant-name"
              className="mb-1 block text-xs font-medium text-sky-100"
            >
              সহকারীর নাম / ডাকনাম (Wake Word)
            </label>
            <input
              id="voice-assistant-name"
              type="text"
              maxLength={40}
              value={assistantName}
              onChange={(e) => setAssistantName(e.target.value)}
              placeholder="পছন্দের ডাকনাম লিখুন (ঐচ্ছিক)"
              className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
            />
            <p className="mt-1 text-[10.5px] text-slate-400">
              {cleanName
                ? `অ্যাপে "${cleanName}" নামে ডাকলে ভয়েস মডেল কথা বলে উঠবে।`
                : 'এখানে যে নাম দেবেন, ভয়েস চ্যাট মোডে শুধু সেই নামটিই ব্যবহৃত হবে।'}
            </p>
          </div>

          {/* 4 Voice Engine Provider Options */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-sky-100">
              ভয়েস প্রোভাইডার ইঞ্জিন (৪টি অপশন)
            </label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setVoiceProvider('default')}
                className={`rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all ${
                  voiceProvider === 'default'
                    ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.2)]'
                    : 'border-white/12 bg-black/40 text-slate-400 hover:text-white'
                }`}
              >
                ডিফল্ট (অটো)
              </button>
              <button
                type="button"
                onClick={() => setVoiceProvider('elevenlabs')}
                className={`rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all ${
                  voiceProvider === 'elevenlabs'
                    ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.2)]'
                    : 'border-white/12 bg-black/40 text-slate-400 hover:text-white'
                }`}
              >
                ElevenLabs
              </button>
              <button
                type="button"
                onClick={() => setVoiceProvider('noiz')}
                className={`rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all ${
                  voiceProvider === 'noiz'
                    ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.2)]'
                    : 'border-white/12 bg-black/40 text-slate-400 hover:text-white'
                }`}
              >
                Noiz.ai
              </button>
              <button
                type="button"
                onClick={() => setVoiceProvider('gemini')}
                className={`rounded-xl border px-2 py-2 text-[11px] font-semibold transition-all ${
                  voiceProvider === 'gemini'
                    ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.2)]'
                    : 'border-white/12 bg-black/40 text-slate-400 hover:text-white'
                }`}
              >
                Gemini
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] text-slate-400">
              {voiceProvider === 'default'
                ? 'ডিফল্ট মোডে কোনো একটি ইঞ্জিনের কোটা শেষ হলে স্বয়ংক্রিয়ভাবে পরের ইঞ্জিনে সুইচ করবে (ElevenLabs → Noiz.ai → Gemini)।'
                : `এখন শুধুমাত্র ${
                    voiceProvider === 'elevenlabs'
                      ? 'ElevenLabs'
                      : voiceProvider === 'noiz'
                        ? 'Noiz.ai'
                        : 'Gemini'
                  } ইঞ্জিন আলাদাভাবে ব্যবহার হবে।`}
            </p>
          </div>

          {/* ElevenLabs Voice ID & Model */}
          {showElevenBlock && (
            <div className="space-y-2.5 rounded-xl border border-emerald-300/20 bg-emerald-950/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="elevenlabs-voice-id"
                  className="block text-xs font-medium text-sky-100"
                >
                  ElevenLabs Voice ID
                </label>
                {elevenLabsVoiceId.trim() && (
                  <button
                    type="button"
                    onClick={() => setElevenLabsVoiceId('')}
                    className="text-[10.5px] font-medium text-amber-200/90 hover:text-amber-100"
                  >
                    ডিফল্ট নিন
                  </button>
                )}
              </div>
              <input
                id="elevenlabs-voice-id"
                type="text"
                maxLength={64}
                value={elevenLabsVoiceId}
                onChange={(e) => setElevenLabsVoiceId(e.target.value)}
                placeholder={
                  serverStatus?.defaultVoiceIdPreview
                    ? `ডিফল্ট সেট আছে (${serverStatus.defaultVoiceIdPreview}) — বদলাতে নতুন ID দিন`
                    : 'ElevenLabs থেকে আপনার Voice ID পেস্ট করুন...'
                }
                className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
              />
              <div>
                <label
                  htmlFor="elevenlabs-model-select"
                  className="mb-1 block text-[11px] font-medium text-slate-300"
                >
                  ElevenLabs ভয়েস মডেল
                </label>
                <select
                  id="elevenlabs-model-select"
                  value={elevenLabsModelId}
                  onChange={(e) => setElevenLabsModelId(e.target.value as ElevenLabsModelId)}
                  className="w-full rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white focus:border-emerald-300/60 focus:outline-none"
                >
                  <option value="eleven_multilingual_v2">
                    Multilingual v2 (বাংলা ও ক্লোন ভয়েসের জন্য সেরা)
                  </option>
                  <option value="eleven_flash_v2_5">Flash v2.5 (দ্রুত রিয়েল-টাইম উত্তর)</option>
                  <option value="eleven_turbo_v2_5">Turbo v2.5 (সুষম গতি ও স্বচ্ছ ভয়েস)</option>
                </select>
              </div>
            </div>
          )}

          {/* Noiz.ai Voice ID & Model */}
          {showNoizBlock && (
            <div className="space-y-2.5 rounded-xl border border-sky-300/20 bg-sky-950/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="noiz-voice-id"
                  className="block text-xs font-medium text-sky-100"
                >
                  Noiz.ai Voice ID
                </label>
                {noizVoiceId.trim() && (
                  <button
                    type="button"
                    onClick={() => setNoizVoiceId('')}
                    className="text-[10.5px] font-medium text-amber-200/90 hover:text-amber-100"
                  >
                    ডিফল্ট নিন
                  </button>
                )}
              </div>
              <input
                id="noiz-voice-id"
                type="text"
                maxLength={80}
                value={noizVoiceId}
                onChange={(e) => setNoizVoiceId(e.target.value)}
                placeholder={
                  serverStatus?.defaultNoizIdPreview
                    ? `ডিফল্ট সেট আছে (${serverStatus.defaultNoizIdPreview}) — বদলাতে নতুন ID দিন`
                    : 'Noiz.ai থেকে আপনার Voice ID পেস্ট করুন...'
                }
                className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-sky-300/60 focus:outline-none"
              />
              <div>
                <label
                  htmlFor="noiz-model-select"
                  className="mb-1 block text-[11px] font-medium text-slate-300"
                >
                  Noiz.ai ভয়েস মডেল
                </label>
                <select
                  id="noiz-model-select"
                  value={noizModelId}
                  onChange={(e) => setNoizModelId(e.target.value as NoizModelId)}
                  className="w-full rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white focus:border-sky-300/60 focus:outline-none"
                >
                  <option value="noiz_multilingual_v1">
                    Noiz Multilingual v1 (স্বাভাবিক কথ্য বাংলা)
                  </option>
                  <option value="noiz_expressive_v1">
                    Noiz Expressive v1 (গভীর আবেগময় সুর)
                  </option>
                </select>
              </div>
            </div>
          )}

          {/* Gemini Voice ID & Model */}
          {showGeminiBlock && (
            <div className="space-y-2.5 rounded-xl border border-violet-300/20 bg-violet-950/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="gemini-voice-id"
                  className="block text-xs font-medium text-sky-100"
                >
                  Gemini Voice ID / নাম
                </label>
                {geminiVoiceId.trim() && (
                  <button
                    type="button"
                    onClick={() => setGeminiVoiceId('')}
                    className="text-[10.5px] font-medium text-amber-200/90 hover:text-amber-100"
                  >
                    ডিফল্ট নিন
                  </button>
                )}
              </div>
              <input
                id="gemini-voice-id"
                type="text"
                maxLength={64}
                list="gemini-prebuilt-voices-list"
                value={geminiVoiceId}
                onChange={(e) => setGeminiVoiceId(e.target.value)}
                placeholder={
                  serverStatus?.defaultGeminiVoicePreview
                    ? `ডিফল্ট সেট আছে (${serverStatus.defaultGeminiVoicePreview}) — বদলাতে নতুন নাম/ID দিন`
                    : 'ডিফল্ট (Puck) বা পছন্দের Gemini Voice লিখুন (যেমন: Kore)'
                }
                className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-violet-300/60 focus:outline-none"
              />
              <datalist id="gemini-prebuilt-voices-list">
                {GEMINI_PREBUILT_VOICES.map((voiceName) => (
                  <option key={voiceName} value={voiceName} />
                ))}
              </datalist>

              <div className="flex flex-wrap gap-1">
                {GEMINI_PREBUILT_VOICES.map((voiceName) => {
                  const selected = geminiVoiceId.trim().toLowerCase() === voiceName.toLowerCase();
                  return (
                    <button
                      key={voiceName}
                      type="button"
                      onClick={() => setGeminiVoiceId(voiceName)}
                      className={`rounded-lg border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                        selected
                          ? 'border-violet-300/60 bg-violet-400/25 text-violet-100'
                          : 'border-white/10 bg-black/40 text-slate-400 hover:border-white/25 hover:text-white'
                      }`}
                    >
                      {voiceName}
                    </button>
                  );
                })}
              </div>

              <div>
                <label
                  htmlFor="gemini-model-select"
                  className="mb-1 block text-[11px] font-medium text-slate-300"
                >
                  Gemini ভয়েস মডেল
                </label>
                <select
                  id="gemini-model-select"
                  value={geminiModelId}
                  onChange={(e) => setGeminiModelId(e.target.value as GeminiModelId)}
                  className="w-full rounded-xl border border-white/15 bg-black/60 px-3 py-1.5 text-xs text-white focus:border-violet-300/60 focus:outline-none"
                >
                  <option value="gemini-3.8-flash-lite-tts">
                    Gemini 3.8 Flash Lite TTS (দ্রুত ও নির্ভরযোগ্য)
                  </option>
                  <option value="gemini-3.8-flash-tts">
                    Gemini 3.8 Flash TTS (আবেগময় ও স্টাইল-নিয়ন্ত্রিত)
                  </option>
                </select>
              </div>
            </div>
          )}

          {/* Optional Personality / Speaking Style */}
          <div>
            <label
              htmlFor="voice-persona-note"
              className="mb-1 block text-xs font-medium text-sky-100"
            >
              কথা বলার ধরন (ঐচ্ছিক)
            </label>
            <input
              id="voice-persona-note"
              type="text"
              maxLength={240}
              value={personaNote}
              onChange={(e) => setPersonaNote(e.target.value)}
              placeholder="যেমন: খুব আন্তরিক, মৃদু ও বন্ধুসুলভ সুরে কথা বলবে"
              className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
            />
          </div>

          {/* Standby Wake-Word Listening Toggle */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-100">
                {cleanName
                  ? `নামে ডাকলে অটো-চালু হবে ("${cleanName}")`
                  : 'ডাকনামে ডাকলে অটো-চালু হবে'}
              </p>
              <p className="text-[10.5px] text-slate-400">
                {cleanName
                  ? 'স্ট্যান্ডবাই মোডে থাকলে নাম ধরে ডাকলেই ভয়েস চ্যাট ওপেন হবে'
                  : 'চালু করতে চাইলে উপরে আগে একটি ডাকনাম লিখুন'}
              </p>
            </div>
            <input
              type="checkbox"
              checked={wakeWordStandby}
              onChange={(e) => setWakeWordStandby(e.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-400"
            />
          </label>

          {/* Detailed Per-Provider Secrets & Voice ID Status Card */}
          <div className="rounded-xl border border-sky-300/20 bg-sky-950/25 p-3">
            <div className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-sky-200">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              <span>সংযুক্ত API কী ও ভয়েস আইডি অবস্থা</span>
            </div>

            <div className="space-y-2 text-[11px]">
              {/* Gemini Status */}
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-violet-200">Gemini AI ও ভয়েস</span>
                  {serverStatus?.geminiConfigured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      {serverStatus.geminiKeyCount && serverStatus.geminiKeyCount > 1
                        ? `যুক্ত আছে (${serverStatus.geminiKeyCount}টি কী)`
                        : '১টি কী যুক্ত আছে'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-300">
                      <AlertCircle className="h-3 w-3" /> Secrets-এ নেই
                    </span>
                  )}
                </div>
                {serverStatus?.geminiKeyNames && serverStatus.geminiKeyNames.length > 0 && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    সংযুক্ত কী: {serverStatus.geminiKeyNames.join(', ')}
                  </p>
                )}
                <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="text-slate-400">ভয়েস আইডি:</span>
                  {geminiVoiceId.trim() ? (
                    <span className="text-emerald-300">
                      ১টি যুক্ত: {maskVoicePreview(geminiVoiceId)}
                    </span>
                  ) : serverStatus?.defaultGeminiVoicePreview ? (
                    <span className="text-sky-200">
                      ডিফল্ট সেট আছে ({serverStatus.defaultGeminiVoicePreview})
                    </span>
                  ) : (
                    <span className="text-slate-300">ডিফল্ট (Puck)</span>
                  )}
                </div>
              </div>

              {/* ElevenLabs Status */}
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-200">ElevenLabs</span>
                  {serverStatus?.elevenLabsConfigured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> API কী যুক্ত আছে
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-300">
                      <AlertCircle className="h-3 w-3" /> Secrets-এ নেই
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="text-slate-400">ভয়েস আইডি:</span>
                  {elevenLabsVoiceId.trim() ? (
                    <span className="text-emerald-300">
                      ১টি যুক্ত: {maskVoicePreview(elevenLabsVoiceId)}
                    </span>
                  ) : serverStatus?.defaultVoiceIdPreview ? (
                    <span className="text-sky-200">
                      ডিফল্ট সেট আছে ({serverStatus.defaultVoiceIdPreview})
                    </span>
                  ) : (
                    <span className="text-amber-300">সেট করা নেই</span>
                  )}
                </div>
              </div>

              {/* Noiz.ai Status */}
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sky-200">Noiz.ai</span>
                  {serverStatus?.noizConfigured ? (
                    <span className="inline-flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> API কী যুক্ত আছে
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-300">
                      <AlertCircle className="h-3 w-3" /> Secrets-এ নেই
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px]">
                  <span className="text-slate-400">ভয়েস আইডি:</span>
                  {noizVoiceId.trim() ? (
                    <span className="text-emerald-300">
                      ১টি যুক্ত: {maskVoicePreview(noizVoiceId)}
                    </span>
                  ) : serverStatus?.defaultNoizIdPreview ? (
                    <span className="text-sky-200">
                      ডিফল্ট সেট আছে ({serverStatus.defaultNoizIdPreview})
                    </span>
                  ) : (
                    <span className="text-amber-300">সেট করা নেই</span>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              API Key গুলো Settings &gt; Secrets প্যানেল থেকে যুক্ত হয় (যেমন: GEMINI_API_KEY, ELEVENLABS_API_KEY, NOIZ_API_KEY এবং ডিফল্ট ভয়েসের জন্য *_VOICE_ID)।
            </p>
          </div>

          {savedFeedback && (
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>ভয়েস সেটিংস সফলভাবে সংরক্ষণ করা হয়েছে।</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>ডিফল্টে ফিরুন</span>
            </button>

            <div className="flex items-center gap-2">
              {onOpenVoiceChat && (
                <button
                  type="button"
                  onClick={() => {
                    onSave(buildCurrentDraft());
                    onClose();
                    onOpenVoiceChat();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30"
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>ভয়েস চ্যাট অন</span>
                </button>
              )}

              <button
                type="submit"
                className="rounded-xl bg-emerald-300 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-200"
              >
                সংরক্ষণ করুন
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
