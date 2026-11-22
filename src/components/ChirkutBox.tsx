import React, { Component, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { KeyRound, Lock, Mail, MailOpen, PenLine, Send, X } from 'lucide-react';
import { PASSWORD_HINT } from '../config/siteConfig';
import {
  CHIRKUT_MESSAGE_MAX_LENGTH,
  ChirkutSender,
  deriveBoxId,
  derivePinToken,
  generateNoteId,
  sanitizeChirkutDraft,
  verifyEntryPin,
  verifyWritePin,
} from '../lib/chirkutCrypto';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { toBengaliDigits } from '../utils/rajshahiWeather';

interface ChirkutNote {
  id: string;
  boxId: string;
  sender: ChirkutSender;
  message: string;
  mood?: string;
  createdAtMs: number;
}

const MOOD_OPTIONS = ['ভালোবাসা', 'মনে পড়ছে', 'অভিমান', 'শুভকামনা', 'নীরব কথা'] as const;

function formatChirkutDateBn(ms: number): string {
  try {
    const dt = new Date(ms);
    const datePart = new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(dt);
    const timePart = new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'Asia/Dhaka',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(dt);
    return `${datePart} · ${timePart}`;
  } catch {
    return 'সদ্য লেখা';
  }
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ChirkutErrorBoundary extends Component<
  { children: React.ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
        >
          <div className="w-full max-w-sm rounded-2xl border border-rose-400/25 bg-[#090d18] p-6 text-center shadow-2xl">
            <p className="font-display text-lg font-semibold text-white">
              চিরকুট বক্স লোড করতে সমস্যা হয়েছে
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onReset();
              }}
              className="mt-5 inline-flex h-9 items-center justify-center rounded-xl bg-slate-100 px-5 text-xs font-medium text-slate-950 transition-colors hover:bg-white"
            >
              ঠিক আছে
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ChirkutBoxInner() {
  const [isOpen, setIsOpen] = useState(false);
  const [unlockedBoxId, setUnlockedBoxId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'read' | 'write'>('read');

  // Entry PIN state
  const [entryPin, setEntryPin] = useState('');
  const [entryPinError, setEntryPinError] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const entryInputRef = useRef<HTMLInputElement | null>(null);

  // Notes state
  const [notes, setNotes] = useState<ChirkutNote[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);

  // Write composer state (always requires write PIN)
  const [sender, setSender] = useState<ChirkutSender>('আমি');
  const [mood, setMood] = useState<string>('');
  const [message, setMessage] = useState('');
  const [writePin, setWritePin] = useState('');
  const [writePinError, setWritePinError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // Surface Firestore errors cleanly through ChirkutErrorBoundary
  const [fatalError, setFatalError] = useState<Error | null>(null);
  if (fatalError) {
    throw fatalError;
  }

  useEffect(() => {
    if (isOpen && !unlockedBoxId) {
      setEntryPin('');
      setEntryPinError(false);
      setShowHint(false);
      const t = window.setTimeout(() => entryInputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [isOpen, unlockedBoxId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  // Real-time Firestore listener (active only while unlocked via PIN)
  useEffect(() => {
    if (!unlockedBoxId) {
      setNotes([]);
      return;
    }

    setIsLoadingNotes(true);
    const notesPath = `chirkut_boxes/${unlockedBoxId}/notes`;
    const q = query(
      collection(db, 'chirkut_boxes', unlockedBoxId, 'notes'),
      where('boxId', '==', unlockedBoxId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: ChirkutNote[] = snapshot.docs.map((d) => {
          const data = d.data({ serverTimestamps: 'estimate' });
          const ts = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
          return {
            id: typeof data.id === 'string' ? data.id : d.id,
            boxId: typeof data.boxId === 'string' ? data.boxId : unlockedBoxId,
            sender: data.sender === 'রুপো' ? 'রুপো' : 'আমি',
            message: typeof data.message === 'string' ? data.message : '',
            mood: typeof data.mood === 'string' ? data.mood : undefined,
            createdAtMs: ts,
          };
        });
        loaded.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setNotes(loaded);
        setIsLoadingNotes(false);
      },
      (error) => {
        setIsLoadingNotes(false);
        try {
          handleFirestoreError(error, OperationType.LIST, notesPath);
        } catch (wrapped) {
          setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );

    return () => unsubscribe();
  }, [unlockedBoxId]);

  const handleClose = () => {
    setIsOpen(false);
    setUnlockedBoxId(null);
    setActiveTab('read');
    setEntryPin('');
    setEntryPinError(false);
    setWritePin('');
    setWritePinError(null);
    setSavedNotice(false);
  };

  const handleEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyEntryPin(entryPin)) {
      setEntryPinError(false);
      setUnlockedBoxId(deriveBoxId(entryPin));
      setEntryPin('');
      setActiveTab('read');
    } else {
      setEntryPinError(true);
      window.setTimeout(() => setEntryPinError(false), 450);
    }
  };

  const handleWriteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockedBoxId || isSaving) return;

    const cleanDraft = sanitizeChirkutDraft({ sender, message, mood });
    if (cleanDraft.message.length === 0) {
      setWritePinError('প্রথমে চিরকুটের লেখাটি লিখুন।');
      return;
    }

    if (!verifyWritePin(writePin)) {
      setWritePinError('লেখার পিন সঠিক নয়। সঠিক পিন দিন।');
      return;
    }

    setWritePinError(null);
    setIsSaving(true);

    const noteId = generateNoteId();
    const notePath = `chirkut_boxes/${unlockedBoxId}/notes/${noteId}`;
    const pinToken = derivePinToken(writePin);

    try {
      await setDoc(doc(db, 'chirkut_boxes', unlockedBoxId, 'notes', noteId), {
        id: noteId,
        boxId: unlockedBoxId,
        sender: cleanDraft.sender,
        message: cleanDraft.message,
        ...(cleanDraft.mood ? { mood: cleanDraft.mood } : {}),
        pinToken,
        createdAt: serverTimestamp(),
      });

      setMessage('');
      setMood('');
      setWritePin('');
      setSavedNotice(true);
      setActiveTab('read');
      window.setTimeout(() => setSavedNotice(false), 3200);
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, notePath);
      } catch (wrapped) {
        setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Bottom-left Compact Envelope Icon Trigger Button */}
      <div className="fixed bottom-2.5 left-2.5 z-40 sm:bottom-4 sm:left-4">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="চিরকুট বক্স"
          aria-label="চিরকুট বক্স খুলুন"
          className="group flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#080c16]/88 text-slate-100 shadow-xl backdrop-blur-md transition-all hover:border-amber-200/40 hover:bg-[#0d1424] focus-visible:outline-2 focus-visible:outline-sky-300"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-300/15 text-amber-200 transition-transform group-hover:scale-105">
            {isOpen && unlockedBoxId ? (
              <MailOpen className="h-3.5 w-3.5" />
            ) : (
              <Mail className="h-3.5 w-3.5" />
            )}
          </span>
        </button>
      </div>

      {/* Step 1: Entry PIN Gate */}
      {isOpen && !unlockedBoxId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chirkut-pin-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
          onClick={handleClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl border border-white/15 bg-[#090d18] p-6 shadow-2xl ${
              entryPinError ? 'animate-shake border-rose-500/70' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-400/12 text-amber-200">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-medium text-amber-200/90">ব্যক্তিগত চিঠির বাক্স</p>
                  <h3 id="chirkut-pin-title" className="font-display mt-0.5 text-xl font-semibold text-white">
                    চিরকুট বক্সে প্রবেশ করুন
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label="বন্ধ করুন"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-300/90">
              আমি বা রুপো—আমাদের লেখা চিরকুটগুলো পড়তে ও নতুন চিরকুট লিখতে পিন দিন।
            </p>

            <form onSubmit={handleEntrySubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="chirkut-entry-pin" className="sr-only">
                  প্রবেশ পিন
                </label>
                <input
                  ref={entryInputRef}
                  id="chirkut-entry-pin"
                  type="password"
                  inputMode="numeric"
                  value={entryPin}
                  onChange={(e) => setEntryPin(e.target.value)}
                  placeholder="৪ সংখ্যার পিন লিখুন..."
                  className="w-full rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-200/70 focus:outline-none"
                />
                {entryPinError && (
                  <p role="alert" className="mt-2 text-xs text-rose-400">
                    পিন সঠিক নয়। আবার চেষ্টা করুন।
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowHint((h) => !h)}
                  className="text-xs text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
                >
                  {showHint ? PASSWORD_HINT : 'পিনের ইঙ্গিত'}
                </button>

                <button
                  type="submit"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-100 px-5 text-sm font-medium text-slate-950 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-amber-200"
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>খুলুন</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Step 2: Unlocked Chirkut Box (Read Saved Notes & Write With PIN) */}
      {isOpen && unlockedBoxId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chirkut-box-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-3 backdrop-blur-md sm:p-5"
          onClick={handleClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#080d18]/96 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-400/12 text-amber-200">
                  <MailOpen className="h-4 w-4" />
                </div>
                <div>
                  <h2 id="chirkut-box-heading" className="font-display text-lg font-semibold text-white">
                    চিরকুট বক্স
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    সংরক্ষিত {toBengaliDigits(notes.length)}টি চিরকুট
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                aria-label="তালাবদ্ধ করে বন্ধ করুন"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/15 hover:text-white"
              >
                <X className="h-4 w-4" />
                <span>বন্ধ করুন</span>
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center gap-2 border-b border-white/10 bg-black/25 px-4 py-2.5 sm:px-6">
              <button
                type="button"
                onClick={() => setActiveTab('read')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition-colors ${
                  activeTab === 'read'
                    ? 'border border-amber-300/40 bg-amber-300/18 text-amber-100'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <MailOpen className="h-3.5 w-3.5" />
                <span>সব চিরকুট</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition-colors ${
                  activeTab === 'write'
                    ? 'border border-sky-300/40 bg-sky-400/20 text-sky-100'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                <PenLine className="h-3.5 w-3.5" />
                <span>নতুন চিরকুট লিখুন</span>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {savedNotice && (
                <div
                  role="status"
                  className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/12 px-4 py-2.5 text-xs font-medium text-emerald-200"
                >
                  চিরকুটটি সফলভাবে সংরক্ষিত হয়েছে।
                </div>
              )}

              {activeTab === 'read' ? (
                isLoadingNotes ? (
                  <div className="py-12 text-center text-xs text-slate-400">
                    চিরকুটগুলো খোলা হচ্ছে...
                  </div>
                ) : notes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-5 py-10 text-center">
                    <Mail className="mx-auto h-7 w-7 text-amber-200/60" />
                    <p className="font-display mt-3 text-base text-slate-200">
                      এখনো কোনো চিরকুট লেখা হয়নি
                    </p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      আমি বা রুপো—প্রথম চিরকুটটি লিখে এখানে রেখে দিন।
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('write')}
                      className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-100 px-4 text-xs font-medium text-slate-950 transition-colors hover:bg-white"
                    >
                      <PenLine className="h-3.5 w-3.5" />
                      <span>প্রথম চিরকুট লিখুন</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {notes.map((note) => {
                      const isRupo = note.sender === 'রুপো';
                      return (
                        <article
                          key={note.id}
                          className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${
                            isRupo
                              ? 'border-rose-300/20 bg-rose-950/15'
                              : 'border-sky-300/20 bg-sky-950/15'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                  isRupo
                                    ? 'bg-rose-400/20 text-rose-200'
                                    : 'bg-sky-400/20 text-sky-200'
                                }`}
                              >
                                {note.sender}
                              </span>
                              {note.mood && (
                                <span className="text-[11px] text-amber-200/80">
                                  · {note.mood}
                                </span>
                              )}
                            </div>
                            <time className="text-[11px] text-slate-400">
                              {formatChirkutDateBn(note.createdAtMs)}
                            </time>
                          </div>

                          <p className="font-display mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100 sm:text-base">
                            {note.message}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : (
                <form onSubmit={handleWriteSubmit} className="space-y-4">
                  {/* Author Selection */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-300">কে লিখছেন?</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(['আমি', 'রুপো'] as const).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setSender(role)}
                          className={`flex h-10 items-center justify-center rounded-xl border text-sm font-medium transition-colors ${
                            sender === role
                              ? role === 'রুপো'
                                ? 'border-rose-300/50 bg-rose-400/20 text-rose-100'
                                : 'border-sky-300/50 bg-sky-400/20 text-sky-100'
                              : 'border-white/12 bg-black/30 text-slate-400 hover:bg-white/5 hover:text-slate-200'
                          }`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Optional Mood Tag */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-slate-300">অনুভূতি (ঐচ্ছিক)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {MOOD_OPTIONS.map((item) => {
                        const selected = mood === item;
                        return (
                          <button
                            key={item}
                            type="button"
                            onClick={() => setMood(selected ? '' : item)}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                              selected
                                ? 'border-amber-300/50 bg-amber-300/20 text-amber-100'
                                : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {item}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Message Input */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="chirkut-message" className="text-xs font-medium text-slate-300">
                        চিরকুটের লেখা
                      </label>
                      <span className="font-mono-tabular text-[11px] text-slate-400">
                        {toBengaliDigits(message.length)} / {toBengaliDigits(CHIRKUT_MESSAGE_MAX_LENGTH)}
                      </span>
                    </div>
                    <textarea
                      id="chirkut-message"
                      rows={5}
                      maxLength={CHIRKUT_MESSAGE_MAX_LENGTH}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="মনের না বলা কথাগুলো এখানে লিখে রাখুন..."
                      className="font-display w-full resize-none rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-sm leading-relaxed text-white placeholder:font-body placeholder:text-slate-500 focus:border-amber-200/70 focus:outline-none"
                    />
                  </div>

                  {/* Write PIN Verification */}
                  <div className="rounded-xl border border-white/10 bg-black/35 p-3.5">
                    <label
                      htmlFor="chirkut-write-pin"
                      className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-200/90"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      <span>লেখাটি পাঠাতে পিন নিশ্চিত করুন</span>
                    </label>
                    <input
                      id="chirkut-write-pin"
                      type="password"
                      inputMode="numeric"
                      value={writePin}
                      onChange={(e) => {
                        setWritePin(e.target.value);
                        if (writePinError) setWritePinError(null);
                      }}
                      placeholder="৪ সংখ্যার পিন দিন..."
                      className="w-full rounded-lg border border-white/15 bg-black/50 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-200/70 focus:outline-none"
                    />
                    {writePinError && (
                      <p role="alert" className="mt-2 text-xs text-rose-400">
                        {writePinError}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('read')}
                      className="h-10 rounded-xl border border-white/12 bg-white/5 px-4 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      ফিরে যান
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-amber-100 px-5 text-sm font-medium text-slate-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{isSaving ? 'সংরক্ষিত হচ্ছে...' : 'চিরকুট পাঠান'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ChirkutBox() {
  const [resetKey, setResetKey] = useState(0);
  return (
    <ChirkutErrorBoundary onReset={() => setResetKey((k) => k + 1)}>
      <ChirkutBoxInner key={resetKey} />
    </ChirkutErrorBoundary>
  );
}
