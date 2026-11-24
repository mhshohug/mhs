export type ElevenLabsModelId =
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5';

export interface VoiceChatConfig {
  assistantName: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: ElevenLabsModelId;
  personaNote: string;
  wakeWordStandby: boolean;
}

export interface VoiceChatServerStatus {
  geminiConfigured: boolean;
  geminiKeyCount?: number;
  elevenLabsConfigured: boolean;
  defaultVoiceIdConfigured: boolean;
  defaultVoiceIdPreview: string | null;
}

export const DEFAULT_ASSISTANT_NAME = 'সোহাগ';

export const DEFAULT_VOICE_CHAT_CONFIG: VoiceChatConfig = {
  assistantName: DEFAULT_ASSISTANT_NAME,
  elevenLabsVoiceId: '',
  elevenLabsModelId: 'eleven_multilingual_v2',
  personaNote: '',
  wakeWordStandby: false,
};

const STORAGE_KEY = 'vtr_voice_chat_config_v1';

export function loadVoiceChatConfig(): VoiceChatConfig {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_VOICE_CHAT_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_CHAT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<VoiceChatConfig>;
    const assistantName =
      typeof parsed.assistantName === 'string' && parsed.assistantName.trim()
        ? parsed.assistantName.trim().slice(0, 40)
        : DEFAULT_ASSISTANT_NAME;
    const elevenLabsVoiceId =
      typeof parsed.elevenLabsVoiceId === 'string'
        ? parsed.elevenLabsVoiceId.trim().slice(0, 64)
        : '';
    const elevenLabsModelId: ElevenLabsModelId =
      parsed.elevenLabsModelId === 'eleven_flash_v2_5' ||
      parsed.elevenLabsModelId === 'eleven_turbo_v2_5'
        ? parsed.elevenLabsModelId
        : 'eleven_multilingual_v2';
    const personaNote =
      typeof parsed.personaNote === 'string'
        ? parsed.personaNote.trim().slice(0, 240)
        : '';
    const wakeWordStandby = Boolean(parsed.wakeWordStandby);

    return {
      assistantName,
      elevenLabsVoiceId,
      elevenLabsModelId,
      personaNote,
      wakeWordStandby,
    };
  } catch {
    return { ...DEFAULT_VOICE_CHAT_CONFIG };
  }
}

export function saveVoiceChatConfig(cfg: VoiceChatConfig): VoiceChatConfig {
  const sanitized: VoiceChatConfig = {
    assistantName: cfg.assistantName.trim().slice(0, 40) || DEFAULT_ASSISTANT_NAME,
    elevenLabsVoiceId: cfg.elevenLabsVoiceId.trim().slice(0, 64),
    elevenLabsModelId:
      cfg.elevenLabsModelId === 'eleven_flash_v2_5' ||
      cfg.elevenLabsModelId === 'eleven_turbo_v2_5'
        ? cfg.elevenLabsModelId
        : 'eleven_multilingual_v2',
    personaNote: cfg.personaNote.trim().slice(0, 240),
    wakeWordStandby: Boolean(cfg.wakeWordStandby),
  };

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // Ignore storage write errors
    }
  }
  return sanitized;
}

const DEFAULT_SOHAG_ALIASES = [
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
  if (!cleanTranscript) return { matched: false, remainder: '' };

  const normalizedTranscript = normalizeSpeechText(cleanTranscript);
  const cleanName = (assistantName || DEFAULT_ASSISTANT_NAME).trim();
  const normalizedName = normalizeSpeechText(cleanName);

  const candidates = new Set<string>([normalizedName]);
  if (
    normalizedName === 'সোহাগ' ||
    normalizedName === 'sohag' ||
    normalizedName === 'shohag'
  ) {
    DEFAULT_SOHAG_ALIASES.forEach((alias) => candidates.add(alias));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const idx = normalizedTranscript.indexOf(candidate);
    if (idx !== -1) {
      // Verify boundaries for short Latin words to avoid accidental mid-word matches
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
      // Bengali SpeechRecognition sometimes joins suffixes like সোহাগকে / সোহাগটা / ওসোহাগ
      if (/[\u0980-\u09FF]/.test(candidate)) {
        const afterText = normalizedTranscript.slice(afterIdx).trim();
        return { matched: true, remainder: afterText };
      }
    }
  }

  return { matched: false, remainder: '' };
}
