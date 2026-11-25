export type ElevenLabsModelId =
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5';

export type NoizModelId = 'noiz_multilingual_v1' | 'noiz_expressive_v1';

export type GeminiModelId = 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts';

export type VoiceProvider = 'default' | 'elevenlabs' | 'noiz' | 'gemini';

export const GEMINI_PREBUILT_VOICES = [
  'Puck',
  'Kore',
  'Charon',
  'Fenrir',
  'Zephyr',
  'Aoede',
  'Leda',
  'Orus',
] as const;

export interface VoiceChatConfig {
  assistantName: string;
  voiceProvider: VoiceProvider;
  elevenLabsVoiceId: string;
  elevenLabsModelId: ElevenLabsModelId;
  noizVoiceId: string;
  noizModelId: NoizModelId;
  geminiVoiceId: string;
  geminiModelId: GeminiModelId;
  personaNote: string;
  wakeWordStandby: boolean;
}

export interface VoiceChatServerStatus {
  geminiConfigured: boolean;
  geminiKeyCount?: number;
  geminiKeyNames?: string[];
  defaultGeminiVoiceConfigured?: boolean;
  defaultGeminiVoicePreview?: string | null;
  elevenLabsConfigured: boolean;
  defaultElevenLabsVoiceConfigured?: boolean;
  defaultElevenLabsVoicePreview?: string | null;
  defaultVoiceIdConfigured: boolean;
  defaultVoiceIdPreview: string | null;
  noizConfigured: boolean;
  defaultNoizVoiceConfigured?: boolean;
  defaultNoizIdPreview: string | null;
}

export const DEFAULT_ASSISTANT_NAME = '';

export const DEFAULT_VOICE_CHAT_CONFIG: VoiceChatConfig = {
  assistantName: DEFAULT_ASSISTANT_NAME,
  voiceProvider: 'default',
  elevenLabsVoiceId: '',
  elevenLabsModelId: 'eleven_multilingual_v2',
  noizVoiceId: '',
  noizModelId: 'noiz_multilingual_v1',
  geminiVoiceId: '',
  geminiModelId: 'gemini-3.8-flash-lite-tts',
  personaNote: '',
  wakeWordStandby: false,
};

const STORAGE_KEY = 'vtr_voice_chat_config_v2';
const LEGACY_STORAGE_KEY = 'vtr_voice_chat_config_v1';

function sanitizeVoiceProvider(raw: unknown): VoiceProvider {
  if (raw === 'default' || raw === 'elevenlabs' || raw === 'noiz' || raw === 'gemini') {
    return raw;
  }
  return 'default';
}

function sanitizeElevenLabsModel(raw: unknown): ElevenLabsModelId {
  if (raw === 'eleven_flash_v2_5' || raw === 'eleven_turbo_v2_5') {
    return raw;
  }
  return 'eleven_multilingual_v2';
}

function sanitizeNoizModel(raw: unknown): NoizModelId {
  return raw === 'noiz_expressive_v1' ? 'noiz_expressive_v1' : 'noiz_multilingual_v1';
}

function sanitizeGeminiModel(raw: unknown): GeminiModelId {
  if (raw === 'gemini-3.8-flash-tts' || raw === 'gemini_expressive_v1') {
    return 'gemini-3.8-flash-tts';
  }
  return 'gemini-3.8-flash-lite-tts';
}

function sanitizeConfigObject(
  parsed: Partial<VoiceChatConfig>,
  options?: { stripLegacyDefaultName?: boolean }
): VoiceChatConfig {
  let assistantName =
    typeof parsed.assistantName === 'string' ? parsed.assistantName.trim().slice(0, 40) : '';
  if (options?.stripLegacyDefaultName && assistantName === 'সোহাগ') {
    assistantName = '';
  }

  return {
    assistantName,
    voiceProvider: sanitizeVoiceProvider(parsed.voiceProvider),
    elevenLabsVoiceId:
      typeof parsed.elevenLabsVoiceId === 'string'
        ? parsed.elevenLabsVoiceId.trim().slice(0, 64)
        : '',
    elevenLabsModelId: sanitizeElevenLabsModel(parsed.elevenLabsModelId),
    noizVoiceId:
      typeof parsed.noizVoiceId === 'string' ? parsed.noizVoiceId.trim().slice(0, 80) : '',
    noizModelId: sanitizeNoizModel(parsed.noizModelId),
    geminiVoiceId:
      typeof parsed.geminiVoiceId === 'string' ? parsed.geminiVoiceId.trim().slice(0, 64) : '',
    geminiModelId: sanitizeGeminiModel(parsed.geminiModelId),
    personaNote:
      typeof parsed.personaNote === 'string' ? parsed.personaNote.trim().slice(0, 240) : '',
    wakeWordStandby: Boolean(parsed.wakeWordStandby),
  };
}

export function loadVoiceChatConfig(): VoiceChatConfig {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_VOICE_CHAT_CONFIG };
  }
  try {
    const rawV2 = window.localStorage.getItem(STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<VoiceChatConfig>;
      return sanitizeConfigObject(parsed);
    }
    const rawV1 = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as Partial<VoiceChatConfig>;
      const migrated = sanitizeConfigObject(parsed, { stripLegacyDefaultName: true });
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return { ...DEFAULT_VOICE_CHAT_CONFIG };
  } catch {
    return { ...DEFAULT_VOICE_CHAT_CONFIG };
  }
}

export function saveVoiceChatConfig(cfg: VoiceChatConfig): VoiceChatConfig {
  const sanitized = sanitizeConfigObject(cfg);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // Ignore storage write errors
    }
  }
  return sanitized;
}

const SOHAG_ALIASES = [
  'সোহাগ',
  'শোহাগ',
  'সোহগ',
  'সোহাগী',
  'sohag',
  'shohag',
  'suhag',
  'sohak',
  'shohak',
  'sohaag',
];

function normalizeSpeechText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?।;:'"~`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesWakeWord(
  rawTranscript: string,
  assistantName: string
): { matched: boolean; remainder: string } {
  const cleanTranscript = rawTranscript.trim();
  const cleanName = assistantName.trim();
  if (!cleanTranscript || !cleanName) return { matched: false, remainder: '' };

  const normalizedTranscript = normalizeSpeechText(cleanTranscript);
  const normalizedName = normalizeSpeechText(cleanName);
  if (!normalizedName) return { matched: false, remainder: '' };

  const candidates = new Set<string>([normalizedName]);
  if (
    normalizedName === 'সোহাগ' ||
    normalizedName === 'sohag' ||
    normalizedName === 'shohag'
  ) {
    SOHAG_ALIASES.forEach((alias) => candidates.add(alias));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const idx = normalizedTranscript.indexOf(candidate);
    if (idx !== -1) {
      const beforeChar = idx > 0 ? normalizedTranscript[idx - 1] : ' ';
      const afterIdx = idx + candidate.length;
      const afterChar =
        afterIdx < normalizedTranscript.length ? normalizedTranscript[afterIdx] : ' ';
      const validStart = beforeChar === ' ';
      const validEnd = afterChar === ' ';
      if (validStart && validEnd) {
        const afterText = normalizedTranscript.slice(afterIdx).trim();
        return { matched: true, remainder: afterText };
      }
      if (/[\u0980-\u09FF]/.test(candidate)) {
        const afterText = normalizedTranscript.slice(afterIdx).trim();
        return { matched: true, remainder: afterText };
      }
    }
  }

  return { matched: false, remainder: '' };
}
