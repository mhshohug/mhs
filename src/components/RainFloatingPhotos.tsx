import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Lock, X } from 'lucide-react';
import { GALLERY_PASSWORD, PASSWORD_HINT } from '../config/siteConfig';
import { FloatingPhoto } from '../data/galleryPhotos';

interface RainFloatingPhotosProps {
  photos: FloatingPhoto[];
  requestAllPhotosView: boolean;
  onCloseAllPhotosView: () => void;
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

  const isPromptOpen =
    (selectedPhoto !== null && unlockedSinglePhoto === null) ||
    (requestAllPhotosView && !unlockedAllPhotos);

  // Well-spaced individual photos rising upward one after another like leaves blown in the wind (NOT clustered!)
  const initialNodes = useMemo<LeafPhotoNode[]>(() => {
    if (photos.length === 0) return [];
    const aspects = ['aspect-[4/3]', 'aspect-square', 'aspect-[3/4]'];

    return Array.from({ length: STREAM_COUNT }, (_, idx) => {
      const seedA = Math.sin((idx + 1) * 19.73) * 43758.5453;
      const fracA = seedA - Math.floor(seedA);
      const seedB = Math.cos((idx + 1) * 43.17) * 19341.123;
      const fracB = seedB - Math.floor(seedB);

      // Evenly distributed horizontal lanes + staggered vertical start positions so they never clump
      const laneWidth = 88 / STREAM_COUNT;
      const xPct = 4 + ((idx * 7) % STREAM_COUNT) * laneWidth + fracA * 6;
      const yPct = (idx / STREAM_COUNT) * 116; // Staggered 0% -> 116% for steady one-after-another stream

      const depth = 0.45 + fracB * 0.85;
      return {
        slotIndex: idx,
        photoIndex: idx % photos.length,
        xPct,
        yPct,
        // Steady upward breeze carrying each leaf photo from bottom to top one after another
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
    if (photos.length === 0) return;
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

        // Blow steadily upward & diagonally in the wind, one after another
        n.yPct -= n.riseSpeed;
        n.xPct += n.windDriftX;
        n.baseRotate += n.rotSpeed;

        // When blown off the top edge, enter cleanly from the bottom with the next photo
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
  }, [photos]);

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

  const closeAll = () => {
    setSelectedPhoto(null);
    setUnlockedSinglePhoto(null);
    setUnlockedAllPhotos(false);
    setActiveLightboxIndex(null);
    setPasswordInput('');
    setPasswordError(false);
    onCloseAllPhotosView();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (isPromptOpen || unlockedSinglePhoto || unlockedAllPhotos)) {
        closeAll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
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

  return (
    <>
      {/* Separate Well-Spaced Blurred Photos Blowing Upward One After Another Like Leaves in the Wind */}
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

      {/* Password-Protected All-Photos Grid Viewer */}
      {unlockedAllPhotos && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="সকল ছবি"
          className="fixed inset-0 z-50 flex flex-col bg-[#04060c]/96 backdrop-blur-md"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 sm:px-6">
            <span className="font-mono-tabular text-xs text-slate-300">
              মোট {photos.length} টি ছবি
            </span>
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

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((photo, idx) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setActiveLightboxIndex(idx)}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40 transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-sky-300"
                >
                  <img
                    src={photo.src}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          </div>

          {activeLightboxIndex !== null && photos[activeLightboxIndex] && (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4"
              onClick={() => setActiveLightboxIndex(null)}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveLightboxIndex(null);
                }}
                aria-label="বন্ধ করুন"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>

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
                alt=""
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
        </div>
      )}
    </>
  );
}
