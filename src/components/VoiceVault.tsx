import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Cloud,
  KeyRound,
  Lock,
  Mic,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { PASSWORD_HINT } from '../config/siteConfig';
import {
  AUTHORIZED_BOX_ID,
  derivePinToken,
  deriveWorkspaceWriteToken,
  verifyEntryPin,
  verifyWritePin,
} from '../lib/chirkutCrypto';
import {
  CloudMediaItem,
  deleteCloudMedia,
  formatStorageBytesBn,
  uploadCloudMedia,
} from '../lib/cloudMediaStore';
import { getActiveAuth } from '../lib/firebase';
import { toBengaliDigits } from '../utils/rajshahiWeather';

interface VoiceItem {
  id: string;
  src: string;
  filename: string;
  title: string;
  createdAtMs: number;
  isCloud?: boolean;
  cloudItem?: CloudMediaItem;
}

interface VoiceVaultProps {
  cloudVoices?: CloudMediaItem[];
  cloudConfigured?: boolean;
  totalCloudBytes?: number;
  activeBoxId?: string | null;
  onRequireAuth?: () => void;
}

function formatTimeBn(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '০০:০০';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${toBengaliDigits(mins).padStart(2, '০')}:${toBengaliDigits(rem).padStart(2, '০')}`;
}

function formatDateBn(ms: number): string {
  try {
    return new Intl.DateTimeFormat('bn-BD', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

export function VoiceVault({
  cloudVoices = [],
  cloudConfigured = false,
  totalCloudBytes = 0,
  activeBoxId = null,
  onRequireAuth,
}: VoiceVaultProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isWorkspaceBypassPin = Boolean(activeBoxId && activeBoxId !== AUTHORIZED_BOX_ID);

  // Layer 1: Password gate to enter the Voice Vault
  const [isEntered, setIsEntered] = useState(false);
  const [entryInput, setEntryInput] = useState('');
  const [entryError, setEntryError] = useState('');

  // Layer 2: Listening code gate to play conversations
  const [verifiedListenCode, setVerifiedListenCode] = useState<string | null>(null);
  const [listenInput, setListenInput] = useState('');
  const [listenError, setListenError] = useState('');
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);

  // Local folder conversations list
  const [localVoices, setLocalVoices] = useState<VoiceItem[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Merged list (Cloud Firestore voices + Local folder voices)
  const voices = useMemo<VoiceItem[]>(() => {
    const cloudMapped: VoiceItem[] = cloudVoices.map((cv) => ({
      id: cv.id,
      src: cv.url,
      filename: cv.publicId,
      title: cv.title,
      createdAtMs: cv.createdAtMs,
      isCloud: true,
      cloudItem: cv,
    }));
    const seen = new Set(cloudMapped.map((v) => v.src));
    const merged = [...cloudMapped];
    for (const lv of localVoices) {
      if (!seen.has(lv.src)) {
        merged.push(lv);
      }
    }
    merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return merged;
  }, [cloudVoices, localVoices]);

  // Audio playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState('');

  // Upload / Mic Recorder panel
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [uploadCodeInput, setUploadCodeInput] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // PIN-protected delete state
  const [deleteTarget, setDeleteTarget] = useState<VoiceItem | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const fetchVoices = async () => {
    setLoadingVoices(true);
    try {
      const res = await fetch('/api/media/list', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { voices?: VoiceItem[] };
        setLocalVoices(Array.isArray(data.voices) ? data.voices : []);
      }
    } catch {
      // ignore network glitches
    } finally {
      setLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (isOpen && isWorkspaceBypassPin && activeBoxId) {
      setIsEntered(true);
      setVerifiedListenCode(deriveWorkspaceWriteToken(activeBoxId));
      setShowAddPanel(false);
    } else if (!isWorkspaceBypassPin && !activeBoxId) {
      setIsEntered(false);
      setVerifiedListenCode(null);
    }
  }, [isOpen, isWorkspaceBypassPin, activeBoxId]);

  useEffect(() => {
    if (isOpen && isEntered) {
      void fetchVoices();
    }
  }, [isOpen, isEntered]);

  const stopRecordingCleanup = () => {
    if (recordTimerRef.current !== null) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const closeModal = () => {
    stopRecordingCleanup();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsOpen(false);
    setIsEntered(false);
    setEntryInput('');
    setEntryError('');
    setVerifiedListenCode(null);
    setListenInput('');
    setListenError('');
    setPendingTrackId(null);
    setActiveVoiceId(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError('');
    setShowAddPanel(false);
    setRecordedBlob(null);
    setSelectedFile(null);
    setNewTitle('');
    setUploadCodeInput('');
    setUploadError('');
    setUploadNotice('');
    setDeleteTarget(null);
    setDeletePin('');
    setDeleteError('');
  };

  const handleEntrySubmit = (e: FormEvent) => {
    e.preventDefault();
    if (verifyEntryPin(entryInput)) {
      setIsEntered(true);
      setEntryError('');
      setEntryInput('');
    } else {
      setEntryError('পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।');
    }
  };

  const startPlayback = (voice: VoiceItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError('');
    if (activeVoiceId === voice.id && audio.src) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        void audio.play().catch(() => {
          setAudioError('অডিওটি প্লে করা যায়নি।');
        });
      }
      return;
    }

    audio.src = voice.src;
    audio.currentTime = 0;
    setActiveVoiceId(voice.id);
    setCurrentTime(0);
    setDuration(0);
    void audio.play().catch(() => {
      setIsPlaying(false);
      setAudioError('অডিও ফরম্যাট বা ফাইলটি চালু করা যায়নি।');
    });
  };

  const handleTrackClick = (voice: VoiceItem) => {
    if (!verifiedListenCode) {
      setPendingTrackId(voice.id);
      setListenError('');
      return;
    }
    startPlayback(voice);
  };

  const handleVerifyListenCode = (e: FormEvent) => {
    e.preventDefault();
    if (!verifyWritePin(listenInput)) {
      setListenError('শোনার কোডটি সঠিক নয়।');
      return;
    }
    const cleanCode = listenInput.trim();
    setVerifiedListenCode(cleanCode);
    setUploadCodeInput(cleanCode);
    setListenInput('');
    setListenError('');

    if (pendingTrackId) {
      const target = voices.find((v) => v.id === pendingTrackId);
      setPendingTrackId(null);
      if (target) {
        startPlayback(target);
      }
    }
  };

  const handleStartRecording = async () => {
    setUploadError('');
    setRecordedBlob(null);
    setSelectedFile(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size > 128) {
          setRecordedBlob(blob);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setUploadError('মাইক্রোফোন অনুমতি পাওয়া যায়নি। চাইলে অডিও ফাইল আপলোড করতে পারেন।');
    }
  };

  const handleStopRecording = () => {
    stopRecordingCleanup();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadError('');
    if (file && file.size > 30 * 1024 * 1024) {
      setUploadError('অডিও ফাইল ৩০ মেগাবাইটের চেয়ে বড় হতে পারবে না।');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    if (file) {
      setRecordedBlob(null);
      if (!newTitle.trim()) {
        setNewTitle(file.name.replace(/\.[^.]+$/, ''));
      }
    }
  };

  const handleUploadVoice = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeBoxId) {
      setUploadError('ক্লাউডে কথোপকথন সংরক্ষণ করতে প্রথমে সাইন ইন করুন।');
      return;
    }
    const codeToUse = isWorkspaceBypassPin ? '' : verifiedListenCode || uploadCodeInput;
    if (!isWorkspaceBypassPin && !verifyWritePin(codeToUse)) {
      setUploadError('সংরক্ষণ করতে সঠিক গোপন কোড দিন।');
      return;
    }
    const payload: Blob | File | null = selectedFile || recordedBlob;
    if (!payload) {
      setUploadError('প্রথমে একটি কথোপকথন রেকর্ড করুন বা অডিও ফাইল বাছুন।');
      return;
    }

    const extFromName = selectedFile?.name.split('.').pop()?.toLowerCase() || 'webm';
    setIsUploading(true);
    setUploadError('');

    try {
      if (cloudConfigured) {
        await uploadCloudMedia({
          boxId: activeBoxId,
          kind: 'voice',
          fileOrBlob: payload,
          pin: codeToUse,
          title: newTitle.trim() || 'আমাদের কথোপকথন',
          extHint: extFromName,
        });
        setUploadNotice('কথোপকথনটি ক্লাউডে স্থায়ীভাবে সংরক্ষিত হয়েছে।');
      } else {
        const activeAuthUser = getActiveAuth().currentUser;
        const idToken = activeAuthUser ? await activeAuthUser.getIdToken() : '';
        const res = await fetch('/api/voice/upload', {
          method: 'POST',
          headers: {
            'Content-Type': payload.type || 'audio/webm',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            ...(codeToUse ? { 'x-voice-pin-token': derivePinToken(codeToUse) } : {}),
            'x-voice-ext': extFromName,
            'x-voice-title': encodeURIComponent(newTitle.trim() || 'আমাদের কথোপকথন'),
          },
          body: payload,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(errData.error || 'কথোপকথন সংরক্ষণ করা যায়নি।');
          return;
        }
        await fetchVoices();
        setUploadNotice('কথোপকথনটি সার্ভারে সংরক্ষিত হয়েছে।');
      }

      if (!isWorkspaceBypassPin && codeToUse) {
        setVerifiedListenCode(codeToUse.trim());
      }
      setRecordedBlob(null);
      setSelectedFile(null);
      setNewTitle('');
      setShowAddPanel(false);
      window.setTimeout(() => setUploadNotice(''), 3500);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'সার্ভারের সাথে সংযোগ বিচ্ছিন্ন হয়েছে।');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmDeleteVoice = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTarget?.cloudItem || isDeleting) return;

    setDeleteError('');
    setIsDeleting(true);
    try {
      await deleteCloudMedia({
        boxId: activeBoxId || deleteTarget.cloudItem.boxId,
        item: deleteTarget.cloudItem,
        pin: isWorkspaceBypassPin ? undefined : deletePin,
      });
      if (activeVoiceId === deleteTarget.id && audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setActiveVoiceId(null);
        setIsPlaying(false);
      }
      setDeleteTarget(null);
      setDeletePin('');
      setUploadNotice('কথোপকথনটি স্থায়ীভাবে মুছে ফেলা হয়েছে।');
      window.setTimeout(() => setUploadNotice(''), 3500);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'কথোপকথনটি মুছে ফেলা যায়নি।');
    } finally {
      setIsDeleting(false);
    }
  };

  const activeVoice = voices.find((v) => v.id === activeVoiceId) || null;

  return (
    <>
      {/* Top-Right Corner Password & Code Protected Voice Conversations Icon */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="কথোপকথন ও ভয়েস বক্স (পাসওয়ার্ড সংরক্ষিত)"
        aria-label="কথোপকথন ও ভয়েস বক্স"
        className="relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/50 text-rose-200 backdrop-blur-md transition-all hover:border-rose-300/45 hover:bg-rose-500/20 hover:text-white focus-visible:outline-2 focus-visible:outline-rose-300 min-[375px]:h-7 min-[375px]:w-7 sm:h-9 sm:w-9"
      >
        <Mic className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-900 bg-rose-400 text-[#050810] shadow"
        >
          <Lock className="h-2 w-2" />
        </span>
      </button>

      {/* Hidden HTML5 Audio Element */}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration || 0);
        }}
        onError={() => {
          setIsPlaying(false);
          setAudioError('অডিওটি প্লে করা যায়নি।');
        }}
      />

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="কথোপকথন ও ভয়েস বক্স"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-md"
        >
          <div className="relative flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a0f1c]/95 text-slate-100 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-rose-300/25 bg-rose-500/20 text-rose-200">
                  <AudioLines className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-white">আমাদের কথোপকথন</h2>
                  <p className="text-[11px] text-slate-400">
                    {isEntered
                      ? verifiedListenCode
                        ? 'কোড যাচাইকৃত · শুনতে ও মুছতে পারবেন'
                        : 'শোনার জন্য কোড দিতে হবে'
                      : 'প্রবেশ করতে পাসওয়ার্ড দিন'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="বন্ধ করুন"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!isEntered ? (
              /* Layer 1: Password Gate */
              <form onSubmit={handleEntrySubmit} className="space-y-3 p-5">
                <div className="flex items-center gap-2 text-xs text-rose-200/90">
                  <Lock className="h-3.5 w-3.5 shrink-0" />
                  <span>এই ভয়েস বক্সে ঢুকতে গোপন পাসওয়ার্ড প্রয়োজন।</span>
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={entryInput}
                  onChange={(e) => setEntryInput(e.target.value)}
                  placeholder="পাসওয়ার্ড লিখুন..."
                  className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/60 focus:outline-none"
                />
                <p className="text-[11px] text-slate-400">{PASSWORD_HINT}</p>
                {entryError && <p className="text-xs text-rose-300">{entryError}</p>}
                <button
                  type="submit"
                  className="w-full rounded-xl bg-rose-500/85 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-500"
                >
                  প্রবেশ করুন
                </button>
              </form>
            ) : (
              /* Unlocked Conversations List + Listening Code Gate */
              <div className="flex min-h-0 flex-1 flex-col">
                {!verifiedListenCode && (
                  <form
                    onSubmit={handleVerifyListenCode}
                    className="space-y-2 border-b border-amber-300/20 bg-amber-500/10 px-4 py-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
                      <KeyRound className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {pendingTrackId
                          ? 'এই কথোপকথনটি শুনতে গোপন কোড লিখুন:'
                          : 'যেকোনো রেকর্ড শুনতে ও যুক্ত করতে কোড দিন:'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        inputMode="numeric"
                        value={listenInput}
                        onChange={(e) => setListenInput(e.target.value)}
                        placeholder="শোনার কোড..."
                        className="min-w-0 flex-1 rounded-lg border border-amber-300/30 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-amber-300 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-amber-400/90 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-300"
                      >
                        আনলক
                      </button>
                    </div>
                    {listenError && <p className="text-[11px] text-rose-300">{listenError}</p>}
                  </form>
                )}

                {verifiedListenCode && (
                  <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-200">
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                      <Unlock className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {totalCloudBytes > 0
                          ? `ক্লাউড: ${formatStorageBytesBn(totalCloudBytes)}`
                          : 'কোড যাচাই সম্পন্ন'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddPanel((v) => !v);
                        setDeleteTarget(null);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] text-slate-100 hover:bg-white/10"
                    >
                      <Plus className="h-3 w-3" />
                      <span>{showAddPanel ? 'তালিকা দেখুন' : 'রেকর্ড যোগ'}</span>
                    </button>
                  </div>
                )}

                {uploadNotice && (
                  <div className="border-b border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-200">
                    {uploadNotice}
                  </div>
                )}

                {/* Record / Upload Form */}
                    {showAddPanel ? (
                  <form onSubmit={handleUploadVoice} className="space-y-3 overflow-y-auto p-4">
                    {!activeBoxId && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300/30 bg-amber-500/12 px-3 py-2 text-[11px] text-amber-200">
                        <span>আপনার অ্যাকাউন্টে অডিও সেভ করতে আগে সাইন ইন করুন।</span>
                        <button
                          type="button"
                          onClick={() => {
                            closeModal();
                            onRequireAuth?.();
                          }}
                          className="shrink-0 rounded-lg bg-amber-200 px-2.5 py-1 text-[10.5px] font-semibold text-slate-950 hover:bg-white"
                        >
                          সাইন ইন
                        </button>
                      </div>
                    )}
                    {!cloudConfigured && (
                      <div className="rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        Cloudinary সেট না থাকায় আপাতত লোকাল সার্ভারে সেভ হবে। স্থায়ী ক্লাউড স্টোরেজের জন্য Settings &gt; Secrets-এ Cloudinary কী দিন।
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="block text-xs text-slate-300">কথোপকথনের শিরোনাম</label>
                      <input
                        type="text"
                        maxLength={120}
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="যেমন: রাতের শেষ কথা..."
                        className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-rose-300/60 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {!isRecording ? (
                        <button
                          type="button"
                          onClick={handleStartRecording}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-300/30 bg-rose-500/15 px-3 py-2.5 text-xs font-medium text-rose-100 hover:bg-rose-500/25"
                        >
                          <Mic className="h-3.5 w-3.5" />
                          <span>ভয়েস রেকর্ড</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopRecording}
                          className="inline-flex animate-pulse items-center justify-center gap-1.5 rounded-xl border border-rose-400 bg-rose-600/80 px-3 py-2.5 text-xs font-medium text-white"
                        >
                          <Square className="h-3 w-3 fill-current" />
                          <span>থামান ({formatTimeBn(recordSeconds)})</span>
                        </button>
                      )}

                      <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-xs font-medium text-slate-200 hover:bg-white/10">
                        <Upload className="h-3.5 w-3.5" />
                        <span>ফাইল বাছুন</span>
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {(recordedBlob || selectedFile) && (
                      <p className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-200">
                        {selectedFile
                          ? `নির্বাচিত ফাইল: ${selectedFile.name}`
                          : `রেকর্ড প্রস্তুত (${formatTimeBn(recordSeconds)})`}
                      </p>
                    )}

                    {uploadError && <p className="text-xs text-rose-300">{uploadError}</p>}

                    <button
                      type="submit"
                      disabled={isUploading || isRecording || !activeBoxId}
                      className="w-full rounded-xl bg-rose-500/85 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
                    >
                      {isUploading
                        ? 'সংরক্ষণ হচ্ছে...'
                        : cloudConfigured
                          ? 'ক্লাউডে সংরক্ষণ করুন'
                          : 'কথোপকথন সংরক্ষণ করুন'}
                    </button>
                  </form>
                ) : (
                  /* Saved Recordings List */
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3.5">
                    {deleteTarget && (
                      <form
                        onSubmit={handleConfirmDeleteVoice}
                        className="mb-2 space-y-2.5 rounded-xl border border-rose-400/35 bg-rose-950/35 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-rose-100">
                            মুছবেন: {deleteTarget.title}?
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteTarget(null);
                              setDeletePin('');
                              setDeleteError('');
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          {!isWorkspaceBypassPin && (
                            <input
                              type="password"
                              inputMode="numeric"
                              autoFocus
                              value={deletePin}
                              onChange={(e) => {
                                setDeletePin(e.target.value);
                                if (deleteError) setDeleteError('');
                              }}
                              placeholder="ডিলিট পিন দিন..."
                              className="min-w-0 flex-1 rounded-lg border border-rose-300/30 bg-black/50 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-rose-300 focus:outline-none"
                            />
                          )}
                          <button
                            type="submit"
                            disabled={isDeleting}
                            className="ml-auto shrink-0 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
                          >
                            {isDeleting ? 'মুছছে...' : 'মুছুন'}
                          </button>
                        </div>
                        {deleteError && <p className="text-[11px] text-rose-300">{deleteError}</p>}
                      </form>
                    )}

                    {loadingVoices && voices.length === 0 ? (
                      <p className="py-6 text-center text-xs text-slate-400">
                        কথোপকথন লোড হচ্ছে...
                      </p>
                    ) : voices.length === 0 ? (
                      <div className="space-y-2 rounded-xl border border-dashed border-white/15 bg-black/30 px-4 py-6 text-center">
                        <p className="text-xs text-slate-300">
                          এখনো কোনো কথোপকথন রেকর্ড সংরক্ষিত নেই।
                        </p>
                        <p className="text-[11px] text-slate-400">
                          উপরে “রেকর্ড যোগ” বাটনে ক্লিক করে সরাসরি রেকর্ড বা অডিও ফাইল আপলোড করুন।
                        </p>
                        {!verifiedListenCode && (
                          <p className="text-[11px] text-amber-200/80">
                            নতুন রেকর্ড যোগ করতে প্রথমে উপরের কোড বক্সে কোড দিন।
                          </p>
                        )}
                      </div>
                    ) : (
                      voices.map((voice, idx) => {
                        const isActive = activeVoiceId === voice.id;
                        return (
                          <div
                            key={voice.id}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors ${
                              isActive
                                ? 'border-rose-300/45 bg-rose-500/15'
                                : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleTrackClick(voice)}
                              className="flex min-w-0 flex-1 items-center justify-between gap-2.5 text-left"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                    isActive && isPlaying
                                      ? 'bg-rose-500 text-white'
                                      : 'bg-white/10 text-rose-200'
                                  }`}
                                >
                                  {!verifiedListenCode ? (
                                    <Lock className="h-3.5 w-3.5 text-amber-300" />
                                  ) : isActive && isPlaying ? (
                                    <Pause className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5 translate-x-0.5" />
                                  )}
                                </span>
                                <div className="min-w-0">
                                  <p className="flex items-center gap-1.5 truncate text-xs font-medium text-slate-100">
                                    <span className="truncate">
                                      {toBengaliDigits(idx + 1)}. {voice.title}
                                    </span>
                                    {voice.isCloud && (
                                      <Cloud className="h-3 w-3 shrink-0 text-sky-300/80" />
                                    )}
                                  </p>
                                  <p className="truncate text-[10.5px] text-slate-400">
                                    {formatDateBn(voice.createdAtMs)}
                                  </p>
                                </div>
                              </div>
                              <span className="shrink-0 text-[10.5px] font-medium text-slate-300">
                                {!verifiedListenCode
                                  ? 'কোড দিন'
                                  : isActive && isPlaying
                                    ? 'চলছে'
                                    : 'শুনুন'}
                              </span>
                            </button>

                            {verifiedListenCode && voice.isCloud && voice.cloudItem && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTarget(voice);
                                  setDeletePin('');
                                  setDeleteError('');
                                }}
                                title="কথোপকথনটি মুছুন"
                                aria-label={`${voice.title} মুছুন`}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-300/25 bg-rose-500/10 text-rose-200 transition-colors hover:bg-rose-500 hover:text-white"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Active Audio Player Bar */}
                {activeVoice && verifiedListenCode && (
                  <div className="space-y-1.5 border-t border-white/10 bg-black/50 px-4 py-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-medium text-rose-200">
                        {activeVoice.title}
                      </span>
                      <span className="shrink-0 text-slate-400">
                        {formatTimeBn(currentTime)} / {formatTimeBn(duration)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={duration > 0 ? duration : 1}
                      step={0.1}
                      value={Math.min(currentTime, duration > 0 ? duration : 1)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setCurrentTime(val);
                        if (audioRef.current) audioRef.current.currentTime = val;
                      }}
                      className="h-1 w-full cursor-pointer accent-rose-400"
                    />
                    {audioError && <p className="text-[11px] text-rose-300">{audioError}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
