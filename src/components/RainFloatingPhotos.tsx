import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  KeyRound,
  Lock,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { GALLERY_PASSWORD, PASSWORD_HINT } from '../config/siteConfig';
import { FloatingPhoto } from '../data/galleryPhotos';
import {
  deleteCloudMedia,
  formatStorageBytesBn,
  PhotoAspect,
  uploadCloudMedia,
} from '../lib/cloudMediaStore';
import { toBengaliDigits } from '../utils/rajshahiWeather';

interface RainFloatingPhotosProps {
  photos: FloatingPhoto[];
  requestAllPhotosView: boolean;
  onCloseAllPhotosView: () => void;
  showFloatingPhotos?: boolean;
  cloudConfigured?: boolean;
  totalCloudBytes?: number;
}

interface LeafPhotoNode {
  slotIndex: number;
  photoIndex: number;
  xPct: number;
  yPct: number;
  riseSpeed: number;
  windDriftX: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  sizePx: number;
  aspectClass: string;
  opacity: number;
  baseRotate: number;
  rotSpeed: number;
  depth: number;
}

const STREAM_COUNT = 22;

export function RainFloatingPhotos({
  photos,
  requestAllPhotosView,
  onCloseAllPhotosView,
  showFloatingPhotos = true,
  cloudConfigured = false,
  totalCloudBytes = 0,
}: RainFloatingPhotosProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });

  const [selectedPhoto, setSelectedPhoto] = useState<FloatingPhoto | null>(null);
  const [unlockedSinglePhoto, setUnlockedSinglePhoto] = useState<FloatingPhoto | null>(null);
  const [unlockedAllPhotos, setUnlockedAllPhotos] = useState(false);
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);

  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Cloud Photo Upload State
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [photoTitle, setPhotoTitle] = useState('');
  const [photoDateLabel, setPhotoDateLabel] = useState('');
  const [photoLocation, setPhotoLocation] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoAspect, setPhotoAspect] = useState<PhotoAspect>('landscape');
  const [uploadPin, setUploadPin] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Cloud Photo PIN-Protected Delete State
  const [deleteTarget, setDeleteTarget] = useState<FloatingPhoto | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isPromptOpen =
    (selectedPhoto !== null && unlockedSinglePhoto === null) ||
    (requestAllPhotosView && !unlockedAllPhotos);

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setUploadPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  // Well-spaced individual photos rising upward one after another like leaves blown in the wind (NOT clustered!)
  const initialNodes = useMemo<LeafPhotoNode[]>(() => {
    if (photos.length === 0) return [];
    const aspects = ['aspect-[4/3]', 'aspect-square', 'aspect-[3/4]'];

    return Array.from({ length: STREAM_COUNT }, (_, idx) => {
      const seedA = Math.sin((idx + 1) * 19.73) * 43758.5453;
      const fracA = seedA - Math.floor(seedA);
      const seedB = Math.cos((idx + 1) * 43.17) * 19341.123;
      const fracB = seedB - Math.floor(seedB);

      const laneWidth = 88 / STREAM_COUNT;
      const xPct = 4 + ((idx * 7) % STREAM_COUNT) * laneWidth + fracA * 6;
      const yPct = (idx / STREAM_COUNT) * 116;

      const depth = 0.45 + fracB * 0.85;
      return {
        slotIndex: idx,
        photoIndex: idx % photos.length,
        xPct,
        yPct,
        riseSpeed: 0.045 + depth * 0.042,
        windDriftX: 0.012 + fracA * 0.018,
        swayAmp: 12 + fracB * 18,
        swayFreq: 0.012 + fracA * 0.012,
        phase: fracB * Math.PI * 2,
        sizePx: Math.round(38 + depth * 24),
        aspectClass: aspects[idx % aspects.length],
        opacity: 0.42 + depth * 0.25,
        baseRotate: (fracA - 0.5) * 28,
        rotSpeed: (fracB - 0.5) * 0.14,
        depth,
      };
    });
  }, [photos.length]);

  const nodesRef = useRef<LeafPhotoNode[]>(initialNodes);
  const nodeElsRef = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    nodesRef.current = initialNodes;
  }, [initialNodes]);

  useEffect(() => {
    if (!showFloatingPhotos || photos.length === 0) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    let animId = 0;
    let tick = 0;

    const frame = () => {
      tick += 1;
      const container = containerRef.current;
      const w = container ? container.clientWidth : window.innerWidth;
      const h = container ? container.clientHeight : window.innerHeight;
      const px = pointerRef.current.x;
      const py = pointerRef.current.y;
      const hasPointer = pointerRef.current.active;

      const list = nodesRef.current;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];

        n.yPct -= n.riseSpeed;
        n.xPct += n.windDriftX;
        n.baseRotate += n.rotSpeed;

        if (n.yPct < -12) {
          n.yPct = 108;
          n.xPct = 4 + ((n.slotIndex * 11 + tick) % 86);
          n.photoIndex = (n.photoIndex + STREAM_COUNT) % photos.length;
        }
        if (n.xPct > 98) {
          n.xPct = 3;
        }

        const el = nodeElsRef.current[i];
        if (el) {
          const swayX = Math.sin(tick * n.swayFreq + n.phase) * n.swayAmp;
          const swayY = Math.cos(tick * n.swayFreq * 0.8 + n.phase) * (n.swayAmp * 0.35);

          let pushX = 0;
          let pushY = 0;
          if (hasPointer) {
            const cx = (n.xPct / 100) * w;
            const cy = (n.yPct / 100) * h;
            const dx = cx - px;
            const dy = cy - py;
            const dist = Math.hypot(dx, dy);
            if (dist < 140 && dist > 1) {
              const force = (1 - dist / 140) * 16 * n.depth;
              pushX = (dx / dist) * force;
              pushY = (dy / dist) * force;
            }
          }

          const tx = (n.xPct / 100) * w + swayX + pushX;
          const ty = (n.yPct / 100) * h + swayY + pushY;
          el.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${n.baseRotate.toFixed(1)}deg)`;
        }
      }

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [photos, showFloatingPhotos]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        pointerRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          active: true,
        };
      }
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  useEffect(() => {
    if (isPromptOpen) {
      setPasswordInput('');
      setPasswordError(false);
      setShowHint(false);
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [isPromptOpen]);

  const resetUploadForm = () => {
    setUploadFile(null);
    setPhotoTitle('');
    setPhotoDateLabel('');
    setPhotoLocation('');
    setPhotoCaption('');
    setPhotoAspect('landscape');
    setUploadPin('');
    setUploadError(null);
  };

  const closeAll = () => {
    setSelectedPhoto(null);
    setUnlockedSinglePhoto(null);
    setUnlockedAllPhotos(false);
    setActiveLightboxIndex(null);
    setPasswordInput('');
    setPasswordError(false);
    setShowUploadPanel(false);
    resetUploadForm();
    setUploadNotice(null);
    setDeleteTarget(null);
    setDeletePin('');
    setDeleteError(null);
    onCloseAllPhotosView();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (isPromptOpen || unlockedSinglePhoto || unlockedAllPhotos)) {
        if (deleteTarget) {
          setDeleteTarget(null);
          setDeletePin('');
          setDeleteError(null);
        } else if (activeLightboxIndex !== null) {
          setActiveLightboxIndex(null);
        } else {
          closeAll();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === GALLERY_PASSWORD) {
      setPasswordError(false);
      if (requestAllPhotosView) {
        setUnlockedAllPhotos(true);
      } else if (selectedPhoto) {
        setUnlockedSinglePhoto(selectedPhoto);
      }
    } else {
      setPasswordError(true);
      window.setTimeout(() => setPasswordError(false), 450);
    }
  };

  const handlePhotoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadError(null);
    if (!file) {
      setUploadFile(null);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setUploadError('ছবিটি ১৫ মেগাবাইটের চেয়ে ছোট হতে হবে।');
      return;
    }
    setUploadFile(file);
    if (!photoTitle.trim()) {
      setPhotoTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80));
    }
  };

  const handleUploadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isUploading) return;
    if (!uploadFile) {
      setUploadError('প্রথমে একটি ছবি বাছুন।');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    try {
      await uploadCloudMedia({
        kind: 'photo',
        fileOrBlob: uploadFile,
        pin: uploadPin,
        title: photoTitle,
        dateLabel: photoDateLabel,
        location: photoLocation,
        caption: photoCaption,
        aspect: photoAspect,
      });
      resetUploadForm();
      setShowUploadPanel(false);
      setUploadNotice('ছবিটি ক্লাউডে সফলভাবে সংরক্ষিত হয়েছে — এখন বাতাসেও ভাসবে।');
      window.setTimeout(() => setUploadNotice(null), 4000);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'ছবি আপলোড করা যায়নি।');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmDelete = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTarget?.cloudItem || isDeleting) return;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      await deleteCloudMedia({
        item: deleteTarget.cloudItem,
        pin: deletePin,
      });
      setDeleteTarget(null);
      setDeletePin('');
      setActiveLightboxIndex(null);
      setUploadNotice('ছবিটি ক্লাউড থেকে স্থায়ীভাবে মুছে ফেলা হয়েছে।');
      window.setTimeout(() => setUploadNotice(null), 3500);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'ছবিটি ডিলিট করা যায়নি।');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Separate Well-Spaced Blurred Photos Blowing Upward One After Another Like Leaves in the Wind */}
      {showFloatingPhotos && (
        <div
          ref={containerRef}
          aria-label="বাতাসে উড়ে যাওয়া স্মৃতি"
          className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
        >
          {initialNodes.map((n, idx) => {
            const photo = photos[n.photoIndex % photos.length];
            if (!photo) return null;

            return (
              <button
                key={n.slotIndex}
                ref={(el) => {
                  nodeElsRef.current[idx] = el;
                }}
                type="button"
                onClick={() => {
                  const current = nodesRef.current[idx];
                  const target = photos[(current?.photoIndex ?? idx) % photos.length] ?? photo;
                  setSelectedPhoto(target);
                }}
                aria-label="সুরক্ষিত ছবি দেখতে ক্লিক করুন"
                style={{
                  width: `${n.sizePx}px`,
                  opacity: n.opacity,
                  transform: `translate3d(${n.xPct}vw, ${n.yPct}vh, 0) rotate(${n.baseRotate}deg)`,
                }}
                className={`pointer-events-auto group absolute left-0 top-0 overflow-hidden rounded-lg border border-white/15 bg-black/25 shadow-md transition-[opacity,border-color] duration-200 hover:z-30 hover:!opacity-95 hover:border-sky-200/60 focus-visible:outline-2 focus-visible:outline-sky-300 ${n.aspectClass}`}
              >
                <img
                  src={photo.src}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover blur-[5px] transition-all duration-300 group-hover:scale-110 group-hover:blur-[2px]"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
                  <Lock className="h-3 w-3 text-white/90" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Password Prompt Modal (Nameless) */}
      {isPromptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rain-password-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
          onClick={closeAll}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl border border-white/15 bg-[#090d18] p-6 shadow-2xl ${
              passwordError ? 'animate-shake border-rose-500/70' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-sky-300/90">সুরক্ষিত প্রবেশ</p>
                <h3 id="rain-password-title" className="font-display mt-1 text-xl font-semibold text-white">
                  {requestAllPhotosView ? 'সব ছবি দেখার জন্য পাসওয়ার্ড দিন' : 'ছবিটি দেখতে পাসওয়ার্ড দিন'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeAll}
                aria-label="বন্ধ করুন"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="rain-photo-password" className="sr-only">
                  পাসওয়ার্ড
                </label>
                <input
                  ref={inputRef}
                  id="rain-photo-password"
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="পাসওয়ার্ড লিখুন..."
                  className="w-full rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-sky-300 focus:outline-none"
                />
                {passwordError && (
                  <p role="alert" className="mt-2 text-xs text-rose-400">
                    পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowHint((h) => !h)}
                  className="text-xs text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
                >
                  {showHint ? PASSWORD_HINT : 'পাসওয়ার্ডের ইঙ্গিত'}
                </button>

                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-950 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-sky-300"
                >
                  প্রবেশ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlocked Crisp Single Photo Lightbox */}
      {unlockedSinglePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-4 backdrop-blur-md"
          onClick={closeAll}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex max-h-[90dvh] max-w-4xl items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl"
          >
            <button
              type="button"
              onClick={closeAll}
              aria-label="বন্ধ করুন"
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>

            <img
              src={unlockedSinglePhoto.src}
              alt=""
              referrerPolicy="no-referrer"
              className="max-h-[86dvh] w-auto max-w-full object-contain"
            />
          </div>
        </div>
      )}

      {/* Password-Protected All-Photos Grid Viewer + Upload & PIN-Protected Delete */}
      {unlockedAllPhotos && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="সকল ছবি"
          className="fixed inset-0 z-50 flex flex-col bg-[#04060c]/96 backdrop-blur-md"
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="font-mono-tabular text-xs text-slate-200">
                মোট {toBengaliDigits(photos.length)} টি ছবি
              </span>
              {totalCloudBytes > 0 && (
                <span className="hidden items-center gap-1 rounded-md border border-sky-300/20 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200 sm:inline-flex">
                  <Cloud className="h-3 w-3" />
                  ক্লাউড: {formatStorageBytesBn(totalCloudBytes)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowUploadPanel((v) => !v);
                  setUploadError(null);
                }}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                  showUploadPanel
                    ? 'border-sky-300/45 bg-sky-400/20 text-sky-100'
                    : 'border-white/15 bg-white/5 text-sky-200 hover:bg-white/15 hover:text-white'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{showUploadPanel ? 'গ্যালারি দেখুন' : 'ছবি আপলোড'}</span>
              </button>

              <button
                type="button"
                onClick={closeAll}
                aria-label="বন্ধ করুন"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium text-white transition-colors hover:bg-white/15"
              >
                <X className="h-4 w-4" />
                <span>বন্ধ করুন</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-6xl space-y-4">
              {uploadNotice && (
                <div
                  role="status"
                  className="rounded-xl border border-emerald-400/30 bg-emerald-500/12 px-4 py-2.5 text-xs font-medium text-emerald-200"
                >
                  {uploadNotice}
                </div>
              )}

              {showUploadPanel && (
                <form
                  onSubmit={handleUploadSubmit}
                  className="rounded-2xl border border-sky-300/20 bg-[#090e1c] p-4 shadow-xl sm:p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">নতুন ছবি ক্লাউডে আপলোড করুন</h3>
                      <p className="text-[11px] text-slate-400">
                        আপলোড করা ছবি এখানে এবং বাতাসে ভাসমান স্মৃতিতেও দেখা যাবে।
                      </p>
                    </div>
                    {!cloudConfigured && (
                      <span className="rounded-lg border border-amber-300/30 bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-200">
                        Cloudinary কী সেট করা বাকি (Settings &gt; Secrets)
                      </span>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                    <label className="group flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-black/40 p-3 text-center transition-colors hover:border-sky-300/60 hover:bg-black/60">
                      {uploadPreviewUrl ? (
                        <img
                          src={uploadPreviewUrl}
                          alt="প্রিভিউ"
                          className="h-full w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <Upload className="h-6 w-6 text-sky-300/80 transition-transform group-hover:scale-110" />
                          <span className="mt-2 text-xs font-medium text-slate-200">ছবি বাছুন</span>
                          <span className="mt-1 text-[10px] text-slate-400">JPG, PNG, WebP (সর্বোচ্চ ১৫ MB)</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoFileChange}
                        className="hidden"
                      />
                    </label>

                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-300">ছবির শিরোনাম</label>
                          <input
                            type="text"
                            maxLength={120}
                            value={photoTitle}
                            onChange={(e) => setPhotoTitle(e.target.value)}
                            placeholder="যেমন: বৃষ্টিভেজা বিকেলের স্মৃতি"
                            className="w-full rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-300">সময় / তারিখ (ঐচ্ছিক)</label>
                          <input
                            type="text"
                            maxLength={60}
                            value={photoDateLabel}
                            onChange={(e) => setPhotoDateLabel(e.target.value)}
                            placeholder="যেমন: এক শান্ত বিকেল"
                            className="w-full rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-300">স্থান (ঐচ্ছিক)</label>
                          <input
                            type="text"
                            maxLength={80}
                            value={photoLocation}
                            onChange={(e) => setPhotoLocation(e.target.value)}
                            placeholder="যেমন: পদ্মা পাড়"
                            className="w-full rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-slate-300">ছবির অনুপাত</label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {([
                              ['landscape', 'আড়াআড়ি'],
                              ['portrait', 'লম্বা'],
                              ['square', 'বর্গ'],
                            ] as const).map(([val, label]) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => setPhotoAspect(val)}
                                className={`h-8 rounded-lg border text-[11px] transition-colors ${
                                  photoAspect === val
                                    ? 'border-sky-300/60 bg-sky-400/20 text-sky-100'
                                    : 'border-white/12 bg-black/30 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] text-slate-300">ক্যাপশন / অনুভূতি (ঐচ্ছিক)</label>
                        <textarea
                          rows={2}
                          maxLength={500}
                          value={photoCaption}
                          onChange={(e) => setPhotoCaption(e.target.value)}
                          placeholder="এই ছবির পেছনের ছোট্ট গল্প..."
                          className="w-full resize-none rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
                        <div className="min-w-[180px] flex-1">
                          <label className="mb-1 flex items-center gap-1.5 text-[11px] text-amber-200/90">
                            <KeyRound className="h-3 w-3" />
                            <span>আপলোড করতে ৪ সংখ্যার পিন দিন</span>
                          </label>
                          <input
                            type="password"
                            inputMode="numeric"
                            value={uploadPin}
                            onChange={(e) => setUploadPin(e.target.value)}
                            placeholder="৪ সংখ্যার পিন..."
                            className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-amber-200/70 focus:outline-none"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isUploading}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-300 px-4 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-200 disabled:opacity-60"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>{isUploading ? 'আপলোড হচ্ছে...' : 'সংরক্ষণ করুন'}</span>
                        </button>
                      </div>

                      {uploadError && (
                        <p role="alert" className="text-xs text-rose-400">
                          {uploadError}
                        </p>
                      )}
                    </div>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {photos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40"
                  >
                    <button
                      type="button"
                      onClick={() => setActiveLightboxIndex(idx)}
                      className="h-full w-full focus-visible:outline-2 focus-visible:outline-sky-300"
                    >
                      <img
                        src={photo.src}
                        alt={photo.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </button>

                    {photo.isCloud && photo.cloudItem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(photo);
                          setDeletePin('');
                          setDeleteError(null);
                        }}
                        title="ছবিটি মুছুন (পিন প্রয়োজন)"
                        aria-label={`${photo.title} মুছুন`}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-rose-300/30 bg-black/75 text-rose-200 opacity-90 backdrop-blur-sm transition-all hover:bg-rose-500 hover:text-white"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {activeLightboxIndex !== null && photos[activeLightboxIndex] && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
              onClick={() => setActiveLightboxIndex(null)}
            >
              <div className="absolute right-4 top-4 flex items-center gap-2">
                {photos[activeLightboxIndex].isCloud && photos[activeLightboxIndex].cloudItem && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(photos[activeLightboxIndex]);
                      setDeletePin('');
                      setDeleteError(null);
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-rose-300/35 bg-rose-950/80 px-3.5 text-xs font-medium text-rose-100 hover:bg-rose-600 hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>মুছুন</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveLightboxIndex(null);
                  }}
                  aria-label="বন্ধ করুন"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveLightboxIndex((i) =>
                    i === null ? 0 : (i - 1 + photos.length) % photos.length
                  );
                }}
                aria-label="আগের ছবি"
                className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              <img
                src={photos[activeLightboxIndex].src}
                alt={photos[activeLightboxIndex].title}
                onClick={(e) => e.stopPropagation()}
                referrerPolicy="no-referrer"
                className="max-h-[86dvh] max-w-[88vw] rounded-xl object-contain"
              />

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveLightboxIndex((i) => (i === null ? 0 : (i + 1) % photos.length));
                }}
                aria-label="পরের ছবি"
                className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white hover:bg-white/20"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* PIN-Protected Cloud Photo Delete Confirmation Modal */}
          {deleteTarget && (
            <div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
              onClick={() => setDeleteTarget(null)}
            >
              <form
                onSubmit={handleConfirmDelete}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-sm rounded-2xl border border-rose-400/25 bg-[#0b101d] p-5 shadow-2xl space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-rose-300">স্থায়ীভাবে মুছে ফেলা</p>
                    <h4 className="mt-0.5 text-base font-semibold text-white">ছবিটি ডিলিট করতে চান?</h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    aria-label="বন্ধ করুন"
                    className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 p-2.5">
                  <img
                    src={deleteTarget.src}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-slate-100">{deleteTarget.title}</p>
                    {deleteTarget.cloudItem && (
                      <p className="text-[11px] text-slate-400">
                        সাইজ: {formatStorageBytesBn(deleteTarget.cloudItem.sizeBytes)}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs text-amber-200/90">
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>ডিলিট নিশ্চিত করতে ৪ সংখ্যার পিন দিন</span>
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    value={deletePin}
                    onChange={(e) => {
                      setDeletePin(e.target.value);
                      if (deleteError) setDeleteError(null);
                    }}
                    placeholder="৪ সংখ্যার পিন..."
                    className="w-full rounded-xl border border-white/15 bg-black/50 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/60 focus:outline-none"
                  />
                  {deleteError && <p className="mt-2 text-xs text-rose-400">{deleteError}</p>}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    className="h-9 rounded-xl border border-white/15 bg-white/5 px-4 text-xs text-slate-300 hover:bg-white/10"
                  >
                    বাতিল
                  </button>
                  <button
                    type="submit"
                    disabled={isDeleting}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-500 px-4 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{isDeleting ? 'মুছে ফেলা হচ্ছে...' : 'স্থায়ীভাবে মুছুন'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}
