import { FormEvent, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Mic,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_VOICE_CHAT_CONFIG,
  ElevenLabsModelId,
  VoiceChatConfig,
  VoiceChatServerStatus,
} from '../lib/voiceChatConfig';

interface VoiceChatSettingsModalProps {
  isOpen: boolean;
  config: VoiceChatConfig;
  serverStatus: VoiceChatServerStatus | null;
  onSave: (next: VoiceChatConfig) => void;
  onClose: () => void;
  onOpenVoiceChat?: () => void;
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
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(config.elevenLabsVoiceId);
  const [elevenLabsModelId, setElevenLabsModelId] = useState<ElevenLabsModelId>(
    config.elevenLabsModelId
  );
  const [personaNote, setPersonaNote] = useState(config.personaNote);
  const [wakeWordStandby, setWakeWordStandby] = useState(config.wakeWordStandby);
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAssistantName(config.assistantName);
    setElevenLabsVoiceId(config.elevenLabsVoiceId);
    setElevenLabsModelId(config.elevenLabsModelId);
    setPersonaNote(config.personaNote);
    setWakeWordStandby(config.wakeWordStandby);
    setSavedFeedback(false);
  }, [isOpen, config]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      assistantName: assistantName.trim() || DEFAULT_ASSISTANT_NAME,
      elevenLabsVoiceId: elevenLabsVoiceId.trim(),
      elevenLabsModelId,
      personaNote: personaNote.trim(),
      wakeWordStandby,
    });
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 2000);
  };

  const handleResetDefaults = () => {
    setAssistantName(DEFAULT_VOICE_CHAT_CONFIG.assistantName);
    setElevenLabsVoiceId('');
    setElevenLabsModelId(DEFAULT_VOICE_CHAT_CONFIG.elevenLabsModelId);
    setPersonaNote('');
    setWakeWordStandby(false);
    onSave({ ...DEFAULT_VOICE_CHAT_CONFIG });
    setSavedFeedback(true);
    window.setTimeout(() => setSavedFeedback(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ভয়েস মডেল সেটিংস"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-3 backdrop-blur-md sm:p-6"
    >
      <div className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#080e1a]/98 p-4 text-slate-100 shadow-2xl sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-200">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">ভয়েস মডেল ও ডাকনাম সেটিংস</h2>
              <p className="text-[11px] text-slate-400">
                নাম ও ElevenLabs Voice ID যে কেউ পরিবর্তন করতে পারবেন
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
              placeholder="যেমন: সোহাগ"
              className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/60 focus:outline-none"
            />
            <p className="mt-1 text-[10.5px] text-slate-400">
              অ্যাপে &ldquo;{assistantName.trim() || DEFAULT_ASSISTANT_NAME}&rdquo; নামে ডাকলে ভয়েস মডেল কথা বলে উঠবে।
            </p>
          </div>

          {/* ElevenLabs Cloned Voice Model ID */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor="elevenlabs-voice-id"
                className="block text-xs font-medium text-sky-100"
              >
                ElevenLabs Voice Model ID (ভয়েস ক্লোন আইডি)
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
            <p className="mt-1 text-[10.5px] text-slate-400">
              খালি রাখলে ডিফল্ট ভয়েস আইডি ব্যবহার হবে; অন্য কেউ চাইলে নিজের Voice ID এখানে বসাতে পারবেন।
            </p>
          </div>

          {/* ElevenLabs Model Selector */}
          <div>
            <label
              htmlFor="elevenlabs-model-select"
              className="mb-1 block text-xs font-medium text-sky-100"
            >
              ElevenLabs ভয়েস ইঞ্জিন মডেল
            </label>
            <select
              id="elevenlabs-model-select"
              value={elevenLabsModelId}
              onChange={(e) => setElevenLabsModelId(e.target.value as ElevenLabsModelId)}
              className="w-full rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-xs text-white focus:border-emerald-300/60 focus:outline-none"
            >
              <option value="eleven_multilingual_v2">
                Multilingual v2 (বাংলা ও ক্লোন ভয়েসের জন্য সেরা)
              </option>
              <option value="eleven_flash_v2_5">
                Flash v2.5 (দ্রুত রিয়েল-টাইম উত্তর)
              </option>
              <option value="eleven_turbo_v2_5">
                Turbo v2.5 (সুষম গতি ও স্বচ্ছ ভয়েস)
              </option>
            </select>
          </div>

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
                নামে ডাকলে অটো-চালু হবে (&ldquo;{assistantName.trim() || DEFAULT_ASSISTANT_NAME}&rdquo;)
              </p>
              <p className="text-[10.5px] text-slate-400">
                স্ট্যান্ডবাই মোডে থাকলে নাম ধরে ডাকলেই ভয়েস চ্যাট ওপেন হবে
              </p>
            </div>
            <input
              type="checkbox"
              checked={wakeWordStandby}
              onChange={(e) => setWakeWordStandby(e.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-400"
            />
          </label>

          {/* Server Secrets Status Card (API keys live securely in Settings > Secrets) */}
          <div className="rounded-xl border border-sky-300/20 bg-sky-950/25 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-sky-200">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              <span>সার্ভার API ও ডিফল্ট সিক্রেটস অবস্থা</span>
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">Gemini AI সংযোগ</span>
                {serverStatus?.geminiConfigured ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />{' '}
                    {serverStatus.geminiKeyCount && serverStatus.geminiKeyCount > 1
                      ? `যুক্ত আছে (${serverStatus.geminiKeyCount}টি কী)`
                      : 'যুক্ত আছে'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <AlertCircle className="h-3 w-3" /> Secrets-এ দিন
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">ElevenLabs ভয়েস API</span>
                {serverStatus?.elevenLabsConfigured ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> যুক্ত আছে
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-300">
                    <AlertCircle className="h-3 w-3" /> Secrets-এ দিন
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">ডিফল্ট Voice ID</span>
                {serverStatus?.defaultVoiceIdConfigured ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> সেট করা আছে
                  </span>
                ) : (
                  <span className="text-slate-400">উপরে ম্যানুয়ালি দিন</span>
                )}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              নিরাপত্তার জন্য Gemini ও ElevenLabs API Key অ্যাপের Settings &gt; Secrets প্যানেলে সংরক্ষিত থাকে।
            </p>
          </div>

          {savedFeedback && (
            <div className="flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-200">
              <Sparkles className="h-3.5 w-3.5" />
              <span>ভয়েস সেটিংস সংরক্ষণ করা হয়েছে।</span>
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
                    onSave({
                      assistantName: assistantName.trim() || DEFAULT_ASSISTANT_NAME,
                      elevenLabsVoiceId: elevenLabsVoiceId.trim(),
                      elevenLabsModelId,
                      personaNote: personaNote.trim(),
                      wakeWordStandby,
                    });
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
