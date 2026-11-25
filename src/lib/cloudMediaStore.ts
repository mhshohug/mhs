import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  AUTHORIZED_BOX_ID,
  derivePinToken,
  deriveWorkspaceWriteToken,
  generateMediaId,
  verifyWritePin,
} from './chirkutCrypto';
import { getActiveAuth, getActiveDb, handleFirestoreError, OperationType } from './firebase';
import { deleteSavedSongLyrics } from './songLyricsStore';
import { toBengaliText } from '../utils/rajshahiWeather';

export type CloudMediaKind = 'photo' | 'voice' | 'song';
export type CloudPlaylistKind = 'normal' | 'birthday';
export type PhotoAspect = 'portrait' | 'landscape' | 'square';

export interface CloudMediaItem {
  id: string;
  boxId: string;
  kind: CloudMediaKind;
  playlistKind?: CloudPlaylistKind;
  title: string;
  subtitle?: string;
  dateLabel?: string;
  location?: string;
  caption?: string;
  aspect?: PhotoAspect;
  url: string;
  publicId: string;
  resourceType: 'image' | 'video';
  sizeBytes: number;
  durationSec?: number;
  createdAtMs: number;
}

export interface CloudMediaSnapshot {
  photos: CloudMediaItem[];
  voices: CloudMediaItem[];
  normalSongs: CloudMediaItem[];
  birthdaySongs: CloudMediaItem[];
  totalBytes: number;
}

export function formatStorageBytesBn(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '০ মেগাবাইট';
  if (bytes < 1024 * 1024) {
    const kb = Math.max(1, Math.round(bytes / 1024));
    return `${toBengaliText(String(kb))} কেবি`;
  }
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `${toBengaliText(mb)} মেগাবাইট`;
}

export async function checkCloudStorageConfigured(): Promise<boolean> {
  try {
    const res = await fetch('/api/media/cloud-status', { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { configured?: boolean };
    return Boolean(data.configured);
  } catch {
    return false;
  }
}

export function subscribeCloudMedia(
  boxId: string | null,
  onData: (data: CloudMediaSnapshot) => void,
  onError?: (err: Error) => void
): () => void {
  const activeAuth = getActiveAuth();
  const activeDb = getActiveDb();
  if (!boxId || !activeAuth.currentUser) {
    onData({
      photos: [],
      voices: [],
      normalSongs: [],
      birthdaySongs: [],
      totalBytes: 0,
    });
    return () => undefined;
  }

  const mediaPath = `chirkut_boxes/${boxId}/media`;
  const q = query(
    collection(activeDb, 'chirkut_boxes', boxId, 'media'),
    where('boxId', '==', boxId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const photos: CloudMediaItem[] = [];
      const voices: CloudMediaItem[] = [];
      const normalSongs: CloudMediaItem[] = [];
      const birthdaySongs: CloudMediaItem[] = [];
      let totalBytes = 0;

      snapshot.docs.forEach((docSnap) => {
        const d = docSnap.data({ serverTimestamps: 'estimate' });
        if (d.status === 'deleted') return;
        const kind = d.kind as CloudMediaKind;
        if (kind !== 'photo' && kind !== 'voice' && kind !== 'song') return;
        if (typeof d.url !== 'string' || typeof d.publicId !== 'string') return;

        const sizeBytes = typeof d.sizeBytes === 'number' && d.sizeBytes > 0 ? d.sizeBytes : 0;
        totalBytes += sizeBytes;

        const createdAtMs =
          d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now();

        const item: CloudMediaItem = {
          id: typeof d.id === 'string' ? d.id : docSnap.id,
          boxId: typeof d.boxId === 'string' ? d.boxId : boxId,
          kind,
          playlistKind: d.playlistKind === 'birthday' ? 'birthday' : 'normal',
          title: typeof d.title === 'string' && d.title.trim() ? d.title : 'স্মৃতি',
          subtitle: typeof d.subtitle === 'string' ? d.subtitle : undefined,
          dateLabel: typeof d.dateLabel === 'string' ? d.dateLabel : undefined,
          location: typeof d.location === 'string' ? d.location : undefined,
          caption: typeof d.caption === 'string' ? d.caption : undefined,
          aspect:
            d.aspect === 'portrait' || d.aspect === 'square' || d.aspect === 'landscape'
              ? d.aspect
              : 'landscape',
          url: d.url,
          publicId: d.publicId,
          resourceType: d.resourceType === 'image' ? 'image' : 'video',
          sizeBytes,
          durationSec: typeof d.durationSec === 'number' ? d.durationSec : undefined,
          createdAtMs,
        };

        if (kind === 'photo') photos.push(item);
        else if (kind === 'voice') voices.push(item);
        else if (kind === 'song') {
          if (item.playlistKind === 'birthday') birthdaySongs.push(item);
          else normalSongs.push(item);
        }
      });

      const byNewest = (a: CloudMediaItem, b: CloudMediaItem) => b.createdAtMs - a.createdAtMs;
      photos.sort(byNewest);
      voices.sort(byNewest);
      normalSongs.sort(byNewest);
      birthdaySongs.sort(byNewest);

      onData({ photos, voices, normalSongs, birthdaySongs, totalBytes });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, mediaPath);
      } catch (wrapped) {
        if (onError) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    }
  );
}

export interface UploadCloudMediaParams {
  boxId: string | null;
  kind: CloudMediaKind;
  fileOrBlob: Blob | File;
  pin?: string;
  title: string;
  subtitle?: string;
  playlistKind?: CloudPlaylistKind;
  dateLabel?: string;
  location?: string;
  caption?: string;
  aspect?: PhotoAspect;
  extHint?: string;
}

async function resolveAuthAndPinToken(
  boxId: string | null,
  rawPin?: string
): Promise<{
  targetBoxId: string;
  pinToken: string;
  idToken: string;
}> {
  const activeAuth = getActiveAuth();
  if (!activeAuth.currentUser || !boxId) {
    throw new Error('আপলোড বা পরিবর্তন করতে প্রথমে বাম কর্নারের ইউজার আইকন থেকে সাইন ইন করুন।');
  }

  const isLegacy = boxId === AUTHORIZED_BOX_ID;
  const cleanPin = (rawPin || '').trim();
  if (isLegacy && !verifyWritePin(cleanPin)) {
    throw new Error('পিন সঠিক নয়। সঠিক ৪ সংখ্যার পিন দিন।');
  }

  const pinToken = isLegacy ? derivePinToken(cleanPin) : deriveWorkspaceWriteToken(boxId);
  const idToken = await activeAuth.currentUser.getIdToken();
  return { targetBoxId: boxId, pinToken, idToken };
}

export async function uploadCloudMedia(
  params: UploadCloudMediaParams
): Promise<CloudMediaItem> {
  const { targetBoxId, pinToken, idToken } = await resolveAuthAndPinToken(
    params.boxId,
    params.pin
  );

  const fileName = params.fileOrBlob instanceof File ? params.fileOrBlob.name : '';
  const extFromName = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
  const ext =
    params.extHint ||
    extFromName ||
    (params.kind === 'photo' ? 'jpg' : params.kind === 'voice' ? 'webm' : 'mp3');

  const uploadRes = await fetch('/api/media/cloud-upload', {
    method: 'POST',
    headers: {
      'Content-Type':
        params.fileOrBlob.type ||
        (params.kind === 'photo' ? 'image/jpeg' : 'application/octet-stream'),
      Authorization: `Bearer ${idToken}`,
      'x-voice-pin-token': pinToken,
      'x-media-kind': params.kind,
      'x-media-ext': ext,
      'x-media-mime': params.fileOrBlob.type || '',
    },
    body: params.fileOrBlob,
  });

  if (!uploadRes.ok) {
    const errData = (await uploadRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'ক্লাউড আপলোড ব্যর্থ হয়েছে।');
  }

  const uploaded = (await uploadRes.json()) as {
    url: string;
    publicId: string;
    resourceType: 'image' | 'video';
    sizeBytes: number;
    durationSec?: number;
  };

  const mediaId = generateMediaId(params.kind);
  const mediaPath = `chirkut_boxes/${targetBoxId}/media/${mediaId}`;

  const cleanTitle =
    params.title.trim().slice(0, 120) ||
    (params.kind === 'photo'
      ? 'নতুন স্মৃতির ছবি'
      : params.kind === 'voice'
        ? 'আমাদের কথোপকথন'
        : 'নতুন গান');

  const cleanSubtitle = params.subtitle?.trim().slice(0, 120);
  const cleanDateLabel = params.dateLabel?.trim().slice(0, 60);
  const cleanLocation = params.location?.trim().slice(0, 80);
  const cleanCaption = params.caption?.trim().slice(0, 500);
  const safeSize = Math.max(1, Math.min(35_000_000, Math.round(uploaded.sizeBytes)));
  const safeDuration =
    typeof uploaded.durationSec === 'number' &&
    Number.isFinite(uploaded.durationSec) &&
    uploaded.durationSec >= 0 &&
    uploaded.durationSec <= 7200
      ? Math.round(uploaded.durationSec)
      : undefined;

  const payload: Record<string, unknown> = {
    id: mediaId,
    boxId: targetBoxId,
    kind: params.kind,
    title: cleanTitle,
    url: uploaded.url,
    publicId: uploaded.publicId,
    resourceType: uploaded.resourceType,
    sizeBytes: safeSize,
    status: 'active',
    pinToken,
    createdAt: serverTimestamp(),
  };

  if (params.kind === 'song') {
    payload.playlistKind = params.playlistKind === 'birthday' ? 'birthday' : 'normal';
  }
  if (cleanSubtitle) payload.subtitle = cleanSubtitle;
  if (cleanDateLabel) payload.dateLabel = cleanDateLabel;
  if (cleanLocation) payload.location = cleanLocation;
  if (cleanCaption) payload.caption = cleanCaption;
  if (params.kind === 'photo' && params.aspect) payload.aspect = params.aspect;
  if (params.kind !== 'photo' && safeDuration !== undefined) {
    payload.durationSec = safeDuration;
  }

  try {
    await setDoc(doc(getActiveDb(), 'chirkut_boxes', targetBoxId, 'media', mediaId), payload);
  } catch (err) {
    // Clean up newly uploaded asset on Cloudinary so orphan files are not left behind
    void fetch('/api/media/cloud-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'x-voice-pin-token': pinToken,
      },
      body: JSON.stringify({
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
      }),
    }).catch(() => undefined);

    handleFirestoreError(err, OperationType.CREATE, mediaPath);
  }

  return {
    id: mediaId,
    boxId: targetBoxId,
    kind: params.kind,
    playlistKind:
      params.kind === 'song'
        ? params.playlistKind === 'birthday'
          ? 'birthday'
          : 'normal'
        : undefined,
    title: cleanTitle,
    subtitle: cleanSubtitle,
    dateLabel: cleanDateLabel,
    location: cleanLocation,
    caption: cleanCaption,
    aspect: params.kind === 'photo' ? params.aspect || 'landscape' : undefined,
    url: uploaded.url,
    publicId: uploaded.publicId,
    resourceType: uploaded.resourceType,
    sizeBytes: safeSize,
    durationSec: safeDuration,
    createdAtMs: Date.now(),
  };
}

export async function deleteCloudMedia(params: {
  boxId?: string | null;
  item: Pick<CloudMediaItem, 'id' | 'boxId' | 'publicId' | 'resourceType'> & {
    kind?: CloudMediaKind;
  };
  pin?: string;
}): Promise<void> {
  const effectiveBoxId = params.boxId || params.item.boxId || null;
  const { targetBoxId, pinToken, idToken } = await resolveAuthAndPinToken(
    effectiveBoxId,
    params.pin
  );

  const cloudDelRes = await fetch('/api/media/cloud-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'x-voice-pin-token': pinToken,
    },
    body: JSON.stringify({
      publicId: params.item.publicId,
      resourceType: params.item.resourceType,
    }),
  });

  if (!cloudDelRes.ok) {
    const errData = (await cloudDelRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'Cloudinary থেকে ফাইলটি ডিলিট করা যায়নি।');
  }

  const mediaPath = `chirkut_boxes/${targetBoxId}/media/${params.item.id}`;
  const docRef = doc(getActiveDb(), 'chirkut_boxes', targetBoxId, 'media', params.item.id);

  try {
    await updateDoc(docRef, {
      status: 'deleted',
      pinToken,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, mediaPath);
  }

  try {
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, mediaPath);
  }

  if (params.item.kind === 'song' || params.item.id.startsWith('media_song_')) {
    await deleteSavedSongLyrics(targetBoxId, params.item.id).catch(() => undefined);
  }
}
