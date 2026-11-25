import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { sha256Hex } from './chirkutCrypto';
import { getActiveAuth, getActiveDb, handleFirestoreError, OperationType } from './firebase';

export const LYRICS_LANG_MODE = 'bn-hinglish-en-v2' as const;

export interface SavedLyricLine {
  startSec: number;
  endSec: number;
  text: string;
}

export interface SavedSongLyricsData {
  songTitle?: string;
  artist?: string;
  instrumental?: boolean;
  sourceType: 'audio' | 'search';
  lines: SavedLyricLine[];
  sources?: Array<{ title: string; uri: string }>;
}

export function resolveSongLyricsDocId(params: {
  trackId?: string;
  isCloud?: boolean;
  src?: string;
}): string {
  if (params.isCloud && params.trackId && /^[a-zA-Z0-9_-]{1,128}$/.test(params.trackId)) {
    return params.trackId;
  }
  const basis = (params.src || params.trackId || 'unknown').trim();
  return `local_song_${sha256Hex(`vtr-song-lyrics-v2:${basis}`).slice(0, 24)}`;
}

export async function getSavedSongLyrics(
  boxId: string | null,
  lyricsId: string
): Promise<SavedSongLyricsData | null> {
  const activeAuth = getActiveAuth();
  if (!boxId || !activeAuth.currentUser || !lyricsId || !/^[a-zA-Z0-9_-]{1,128}$/.test(lyricsId)) {
    return null;
  }
  const path = `chirkut_boxes/${boxId}/song_lyrics/${lyricsId}`;
  const docRef = doc(getActiveDb(), 'chirkut_boxes', boxId, 'song_lyrics', lyricsId);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    const d = snap.data();
    if (!d || d.langMode !== LYRICS_LANG_MODE) return null;

    const lines: SavedLyricLine[] = Array.isArray(d.lines)
      ? d.lines
          .filter(
            (item): item is { startSec: number; endSec: number; text: string } =>
              Boolean(item) &&
              typeof item.startSec === 'number' &&
              typeof item.endSec === 'number' &&
              typeof item.text === 'string' &&
              item.text.trim().length > 0
          )
          .slice(0, 220)
      : [];

    const instrumental = Boolean(d.instrumental);
    if (!instrumental && lines.length < 2) return null;

    return {
      songTitle: typeof d.songTitle === 'string' ? d.songTitle : undefined,
      artist: typeof d.artist === 'string' ? d.artist : undefined,
      instrumental,
      sourceType: d.sourceType === 'audio' ? 'audio' : 'search',
      lines,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function saveSongLyricsToFirestore(params: {
  boxId: string | null;
  lyricsId: string;
  fallbackTitle: string;
  data: SavedSongLyricsData;
}): Promise<void> {
  const { boxId, lyricsId, fallbackTitle, data } = params;
  const activeAuth = getActiveAuth();
  if (!boxId || !activeAuth.currentUser || !lyricsId || !/^[a-zA-Z0-9_-]{1,128}$/.test(lyricsId)) {
    return;
  }

  const cleanLines: SavedLyricLine[] = Array.isArray(data.lines)
    ? data.lines
        .filter(
          (l) =>
            l &&
            typeof l.startSec === 'number' &&
            Number.isFinite(l.startSec) &&
            typeof l.endSec === 'number' &&
            Number.isFinite(l.endSec) &&
            typeof l.text === 'string' &&
            l.text.trim().length > 0
        )
        .slice(0, 220)
        .map((l) => {
          const start = Number(Math.max(0, l.startSec).toFixed(2));
          const end = Number(Math.max(start + 1.2, l.endSec).toFixed(2));
          return {
            startSec: start,
            endSec: end,
            text: l.text.replace(/\s+/g, ' ').trim().slice(0, 240),
          };
        })
    : [];

  const isInstrumental = Boolean(data.instrumental);
  if (!isInstrumental && cleanLines.length < 2) return;

  const cleanTitle =
    (data.songTitle || fallbackTitle || 'গান').replace(/\s+/g, ' ').trim().slice(0, 160) ||
    'গান';
  const cleanArtist =
    typeof data.artist === 'string'
      ? data.artist.replace(/\s+/g, ' ').trim().slice(0, 160)
      : '';

  const path = `chirkut_boxes/${boxId}/song_lyrics/${lyricsId}`;
  const docRef = doc(getActiveDb(), 'chirkut_boxes', boxId, 'song_lyrics', lyricsId);

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) return;

    const payload: Record<string, unknown> = {
      id: lyricsId,
      boxId,
      songTitle: cleanTitle,
      sourceType: data.sourceType === 'audio' ? 'audio' : 'search',
      instrumental: isInstrumental,
      langMode: LYRICS_LANG_MODE,
      lines: cleanLines,
      createdAt: serverTimestamp(),
    };
    if (cleanArtist) {
      payload.artist = cleanArtist;
    }

    await setDoc(docRef, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteSavedSongLyrics(
  boxId: string | null,
  lyricsId: string
): Promise<void> {
  const activeAuth = getActiveAuth();
  if (!boxId || !activeAuth.currentUser || !lyricsId || !/^[a-zA-Z0-9_-]{1,128}$/.test(lyricsId)) {
    return;
  }
  const path = `chirkut_boxes/${boxId}/song_lyrics/${lyricsId}`;
  const docRef = doc(getActiveDb(), 'chirkut_boxes', boxId, 'song_lyrics', lyricsId);

  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}
