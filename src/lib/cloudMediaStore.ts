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
  generateMediaId,
  verifyWritePin,
} from './chirkutCrypto';
import { db, handleFirestoreError, OperationType } from './firebase';
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
  onData: (data: CloudMediaSnapshot) => void,
  onError?: (err: Error) => void
): () => void {
  const mediaPath = `chirkut_boxes/${AUTHORIZED_BOX_ID}/media`;
  const q = query(
    collection(db, 'chirkut_boxes', AUTHORIZED_BOX_ID, 'media'),
    where('boxId', '==', AUTHORIZED_BOX_ID)
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
          boxId: typeof d.boxId === 'string' ? d.boxId : AUTHORIZED_BOX_ID,
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
  kind: CloudMediaKind;
  fileOrBlob: Blob | File;
  pin: string;
  title: string;
  subtitle?: string;
  playlistKind?: CloudPlaylistKind;
  dateLabel?: string;
  location?: string;
  caption?: string;
  aspect?: PhotoAspect;
  extHint?: string;
}

export async function uploadCloudMedia(
  params: UploadCloudMediaParams
): Promise<CloudMediaItem> {
  const cleanPin = params.pin.trim();
  if (!verifyWritePin(cleanPin)) {
    throw new Error('পিন সঠিক নয়। সঠিক ৪ সংখ্যার পিন দিন।');
  }

  const pinToken = derivePinToken(cleanPin);
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
  const mediaPath = `chirkut_boxes/${AUTHORIZED_BOX_ID}/media/${mediaId}`;

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
    boxId: AUTHORIZED_BOX_ID,
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
    await setDoc(doc(db, 'chirkut_boxes', AUTHORIZED_BOX_ID, 'media', mediaId), payload);
  } catch (err) {
    // Clean up newly uploaded asset on Cloudinary so orphan files are not left behind
    void fetch('/api/media/cloud-delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    boxId: AUTHORIZED_BOX_ID,
    kind: params.kind,
    playlistKind: params.kind === 'song' ? (params.playlistKind === 'birthday' ? 'birthday' : 'normal') : undefined,
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
  item: Pick<CloudMediaItem, 'id' | 'publicId' | 'resourceType'>;
  pin: string;
}): Promise<void> {
  const cleanPin = params.pin.trim();
  if (!verifyWritePin(cleanPin)) {
    throw new Error('পিন সঠিক নয়। ডিলিট করতে সঠিক ৪ সংখ্যার পিন দিন।');
  }

  const pinToken = derivePinToken(cleanPin);

  const cloudDelRes = await fetch('/api/media/cloud-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

  const mediaPath = `chirkut_boxes/${AUTHORIZED_BOX_ID}/media/${params.item.id}`;
  const docRef = doc(db, 'chirkut_boxes', AUTHORIZED_BOX_ID, 'media', params.item.id);

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
}
