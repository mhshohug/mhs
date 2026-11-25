import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  Heart,
  HeartHandshake,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  PlusCircle,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useCoupleAuth } from '../contexts/CoupleAuthContext';
import { AUTHORIZED_BOX_ID } from '../lib/chirkutCrypto';
import {
  formatBirthdayDisplayBn,
  mapFirebaseAuthErrorBn,
  normalizeEmail,
  RELATIONSHIP_LABELS_BN,
  RelationshipType,
  signInCoupleMember,
  signUpCouple,
} from '../lib/coupleAuth';
import { AccountSlotIndex } from '../lib/firebase';

interface CoupleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const RELATIONSHIP_OPTIONS: Array<{
  id: RelationshipType;
  label: string;
  hint: string;
}> = [
  {
    id: 'ex',
    label: 'এক্স',
    hint: 'ফেলে আসা স্মৃতি ও নীরব ভালোবাসা',
  },
  {
    id: 'spouse',
    label: 'ওয়াইফ / হাজবেন্ড',
    hint: 'সংসারের গভীর রোমান্টিক ভালোবাসা ও পাশে থাকা',
  },
  {
    id: 'couple',
    label: 'প্রেমিক-প্রেমিকা',
    hint: 'ভালোবাসা ও কিছুদিন পরই একসাথে থাকার স্বপ্ন',
  },
];

function relationshipBadgeClass(type: RelationshipType): string {
  if (type === 'spouse') {
    return 'border-rose-300/40 bg-rose-400/15 text-rose-200';
  }
  if (type === 'couple') {
    return 'border-amber-300/40 bg-amber-400/15 text-amber-200';
  }
  return 'border-sky-300/40 bg-sky-400/15 text-sky-200';
}

export function CoupleAuthModal({ isOpen, onClose }: CoupleAuthModalProps) {
  const {
    activeSlotIndex,
    slots,
    user,
    workspace,
    workspaceLoading,
    switchAccountSlot,
    setSlotWorkspaceDirect,
    signOutSlot,
    signOutAll,
  } = useCoupleAuth();

  const [isAddingSecondAccount, setIsAddingSecondAccount] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  const [relationshipType, setRelationshipType] = useState<RelationshipType>('ex');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryName, setPrimaryName] = useState('');
  const [primaryBirthday, setPrimaryBirthday] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerBirthday, setPartnerBirthday] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [claimLegacyUploads, setClaimLegacyUploads] = useState(true);
  const [legacyPin, setLegacyPin] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isProviderDisabled, setIsProviderDisabled] = useState(false);
  const [noticeText, setNoticeText] = useState<string | null>(null);

  const signedInCount = (slots[0].user ? 1 : 0) + (slots[1].user ? 1 : 0);
  const emptySlotIndex: AccountSlotIndex | null = !slots[0].user ? 0 : !slots[1].user ? 1 : null;
  const targetAuthSlot: AccountSlotIndex = isAddingSecondAccount
    ? emptySlotIndex ?? activeSlotIndex
    : emptySlotIndex ?? 0;

  useEffect(() => {
    if (!isOpen) return;
    setErrorText(null);
    setNoticeText(null);
    setIsProviderDisabled(false);
    setIsAddingSecondAccount(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const showAuthForm = !user || isAddingSecondAccount;

  const findExistingSlotByEmail = (email: string): AccountSlotIndex | null => {
    const norm = normalizeEmail(email);
    for (const s of slots) {
      const slotEmail = normalizeEmail(s.workspace?.selfEmail || s.user?.email || '');
      if (s.user && slotEmail && slotEmail === norm) {
        return s.slotIndex;
      }
    }
    return null;
  };

  const resetFormFields = () => {
    setSignInEmail('');
    setSignInPassword('');
    setPrimaryEmail('');
    setPrimaryName('');
    setPrimaryBirthday('');
    setPartnerEmail('');
    setPartnerName('');
    setPartnerBirthday('');
    setSignUpPassword('');
    setConfirmPassword('');
    setLegacyPin('');
  };

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorText(null);
    setIsProviderDisabled(false);

    const existingSlot = findExistingSlotByEmail(signInEmail);
    if (existingSlot !== null) {
      switchAccountSlot(existingSlot);
      setIsAddingSecondAccount(false);
      setSignInPassword('');
      setNoticeText('এই ইমেইলটি আগে থেকেই লগইন করা ছিল—সরাসরি সুইচ করা হয়েছে।');
      return;
    }

    setSubmitting(true);
    try {
      const ws = await signInCoupleMember(
        {
          email: signInEmail,
          password: signInPassword,
        },
        targetAuthSlot
      );
      if (ws) {
        setSlotWorkspaceDirect(targetAuthSlot, ws);
      }
      switchAccountSlot(targetAuthSlot);
      setSignInPassword('');
      setSignInEmail('');
      setIsAddingSecondAccount(false);
      if (signedInCount >= 1) {
        setNoticeText('দ্বিতীয় অ্যাকাউন্টটি যুক্ত ও সক্রিয় করা হয়েছে।');
      } else {
        onClose();
      }
    } catch (err) {
      const mapped = mapFirebaseAuthErrorBn(err);
      setErrorText(mapped.message);
      setIsProviderDisabled(Boolean(mapped.isProviderDisabled));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorText(null);
    setIsProviderDisabled(false);

    if (signUpPassword !== confirmPassword) {
      setErrorText('দুই বার লেখা পাসওয়ার্ডটি মেলেনি।');
      return;
    }

    setSubmitting(true);
    try {
      const ws = await signUpCouple(
        {
          primaryEmail,
          primaryName,
          primaryBirthday,
          partnerEmail,
          partnerName,
          partnerBirthday,
          relationshipType,
          password: signUpPassword,
          claimLegacyUploads,
          legacyPin,
        },
        targetAuthSlot
      );
      setSlotWorkspaceDirect(targetAuthSlot, ws);
      switchAccountSlot(targetAuthSlot);
      resetFormFields();
      setIsAddingSecondAccount(false);
      setNoticeText('দুইজনের ইমেইল, নাম, জন্মদিন ও সম্পর্কের ধরনসহ অ্যাকাউন্ট তৈরি হয়েছে।');
    } catch (err) {
      const mapped = mapFirebaseAuthErrorBn(err);
      setErrorText(mapped.message);
      setIsProviderDisabled(Boolean(mapped.isProviderDisabled));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchSlot = (slotIdx: AccountSlotIndex) => {
    if (slotIdx === activeSlotIndex || !slots[slotIdx].user) return;
    switchAccountSlot(slotIdx);
    setErrorText(null);
    const label =
      slots[slotIdx].workspace?.selfName ||
      slots[slotIdx].workspace?.selfEmail ||
      slots[slotIdx].user?.email ||
      'অ্যাকাউন্ট';
    setNoticeText(`"${label}" অ্যাকাউন্টে সুইচ করা হয়েছে।`);
  };

  const handleSignOutOne = async (slotIdx: AccountSlotIndex) => {
    if (submitting) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await signOutSlot(slotIdx);
      setNoticeText('অ্যাকাউন্টটি থেকে সাইন আউট করা হয়েছে।');
    } catch (err) {
      const mapped = mapFirebaseAuthErrorBn(err);
      setErrorText(mapped.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOutAllAccounts = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      await signOutAll();
      setNoticeText(null);
      setIsAddingSecondAccount(false);
    } catch (err) {
      const mapped = mapFirebaseAuthErrorBn(err);
      setErrorText(mapped.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="অ্যাকাউন্ট সাইন ইন, সাইন আপ ও সুইচ"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-md sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#090e1a]/96 text-slate-100 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-300/30 bg-sky-400/15 text-sky-200">
              {user && !isAddingSecondAccount ? (
                <UserCheck className="h-4 w-4" />
              ) : (
                <Users className="h-4 w-4" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {isAddingSecondAccount
                  ? 'দ্বিতীয় অ্যাকাউন্ট যোগ করুন'
                  : user
                    ? 'সংযুক্ত অ্যাকাউন্ট ও সুইচ'
                    : 'সাইন ইন / সাইন আপ'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isAddingSecondAccount
                  ? 'নিজের আরেকটি ইমেইল দিয়ে সর্বোচ্চ ২টি অ্যাকাউন্টে সুইচ করতে পারবেন'
                  : user
                    ? 'আপনার আপলোড করা গান, ছবি, অডিও, চিরকুট ও লেখার ধরন'
                    : 'দুইটি ইমেইল, একটি পাসওয়ার্ড — একসাথে সব স্মৃতি'}
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {noticeText && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/12 px-3.5 py-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{noticeText}</span>
            </div>
          )}

          {!showAuthForm && user ? (
            <div className="space-y-4">
              {workspaceLoading ? (
                <p className="py-6 text-center text-xs text-slate-400">অ্যাকাউন্ট লোড হচ্ছে...</p>
              ) : (
                <>
                  {/* Active Account Profile Card */}
                  <div className="space-y-2.5 rounded-xl border border-white/12 bg-black/45 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                      <span className="text-[11px] text-slate-400">সম্পর্কের ধরন</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium ${relationshipBadgeClass(
                          workspace?.relationshipType ?? 'ex'
                        )}`}
                      >
                        <Heart className="h-3 w-3" />
                        {RELATIONSHIP_LABELS_BN[workspace?.relationshipType ?? 'ex']}
                      </span>
                    </div>

                    <div className="space-y-1 border-b border-white/10 pb-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">আপনি</span>
                        <span className="truncate text-xs font-semibold text-emerald-200">
                          {workspace?.selfName || workspace?.selfEmail || user.email}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span className="truncate">{workspace?.selfEmail || user.email}</span>
                        {workspace?.selfBirthday && (
                          <span className="inline-flex items-center gap-1 text-slate-300">
                            <Calendar className="h-3 w-3 text-emerald-300/80" />
                            {formatBirthdayDisplayBn(workspace.selfBirthday)}
                          </span>
                        )}
                      </div>
                    </div>

                    {(workspace?.partnerEmail || workspace?.partnerName) && (
                      <div className="space-y-1 border-b border-white/10 pb-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">পার্টনার</span>
                          <span className="truncate text-xs font-semibold text-sky-200">
                            {workspace?.partnerName || workspace?.partnerEmail}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                          <span className="truncate">{workspace?.partnerEmail}</span>
                          {workspace?.partnerBirthday && (
                            <span className="inline-flex items-center gap-1 text-slate-300">
                              <Calendar className="h-3 w-3 text-sky-300/80" />
                              {formatBirthdayDisplayBn(workspace.partnerBirthday)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">স্ট্যাটাস</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {workspace?.boxId === AUTHORIZED_BOX_ID
                          ? 'মূল স্মৃতিসহ সংযুক্ত'
                          : workspace
                            ? 'ব্যক্তিগত শেয়ার্ড স্পেস'
                            : 'স্পেস পাওয়া যায়নি'}
                      </span>
                    </div>
                  </div>

                  {/* Account Switcher (Max 2 Accounts for same user) */}
                  <div className="space-y-2.5 rounded-xl border border-white/12 bg-white/[0.03] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-200">
                        <ArrowLeftRight className="h-3.5 w-3.5 text-sky-300" />
                        <span>আপনার অ্যাকাউন্ট সুইচ</span>
                      </span>
                      <span className="text-[10.5px] text-slate-400">
                        {signedInCount === 2 ? '২ / ২টি যুক্ত আছে' : '১ / ২টি যুক্ত আছে'}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {slots.map((slot) => {
                        if (!slot.user) return null;
                        const isActive = slot.slotIndex === activeSlotIndex;
                        const relType = slot.workspace?.relationshipType ?? 'ex';
                        const displayName =
                          slot.workspace?.selfName ||
                          slot.workspace?.selfEmail ||
                          slot.user.email ||
                          'অ্যাকাউন্ট';
                        const displayEmail =
                          slot.workspace?.selfEmail || slot.user.email || '';

                        return (
                          <div
                            key={slot.slotIndex}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors ${
                              isActive
                                ? 'border-emerald-300/45 bg-emerald-400/12'
                                : 'border-white/10 bg-black/40'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-white">
                                  {displayName}
                                </span>
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] border ${relationshipBadgeClass(
                                    relType
                                  )}`}
                                >
                                  {RELATIONSHIP_LABELS_BN[relType].split(' ')[0]}
                                </span>
                                {isActive && (
                                  <span className="shrink-0 rounded bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
                                    সক্রিয়
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-[10.5px] text-slate-400">
                                {displayEmail}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              {!isActive && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => handleSwitchSlot(slot.slotIndex)}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-sky-300/40 bg-sky-400/20 px-2.5 text-[11px] font-medium text-sky-100 transition-colors hover:bg-sky-400/35"
                                >
                                  <ArrowLeftRight className="h-3 w-3" />
                                  <span>সুইচ</span>
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleSignOutOne(slot.slotIndex)}
                                title="এই অ্যাকাউন্ট থেকে সাইন আউট করুন"
                                aria-label="এই অ্যাকাউন্ট থেকে সাইন আউট করুন"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-300/25 bg-rose-500/10 text-rose-200 transition-colors hover:bg-rose-500 hover:text-white"
                              >
                                <LogOut className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {emptySlotIndex !== null ? (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorText(null);
                          setNoticeText(null);
                          setMode('signin');
                          setClaimLegacyUploads(false);
                          setIsAddingSecondAccount(true);
                        }}
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-300/35 bg-sky-400/10 text-xs font-medium text-sky-100 transition-colors hover:border-sky-300/60 hover:bg-sky-400/20"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        <span>দ্বিতীয় অ্যাকাউন্ট যোগ করুন (সর্বোচ্চ ২টি)</span>
                      </button>
                    ) : (
                      <p className="text-center text-[10.5px] text-slate-400">
                        একজন ব্যবহারকারীর জন্য সর্বোচ্চ ২টি অ্যাকাউন্ট যুক্ত করা যায়।
                      </p>
                    )}
                  </div>
                </>
              )}

              {errorText && (
                <p role="alert" className="text-xs text-rose-400">
                  {errorText}
                </p>
              )}

              <button
                type="button"
                onClick={
                  signedInCount > 1
                    ? handleSignOutAllAccounts
                    : () => handleSignOutOne(activeSlotIndex)
                }
                disabled={submitting}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-300/30 bg-rose-500/15 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500 hover:text-white disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                <span>
                  {submitting
                    ? 'সাইন আউট হচ্ছে...'
                    : signedInCount > 1
                      ? 'সব অ্যাকাউন্ট থেকে সাইন আউট করুন'
                      : 'সাইন আউট করুন'}
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {isAddingSecondAccount && (
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingSecondAccount(false);
                    setErrorText(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-sky-200 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>সক্রিয় অ্যাকাউন্টে ফিরে যান</span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/40 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setErrorText(null);
                    setIsProviderDisabled(false);
                  }}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                    mode === 'signin'
                      ? 'border border-sky-300/40 bg-sky-400/20 text-sky-100'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>সাইন ইন</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorText(null);
                    setIsProviderDisabled(false);
                  }}
                  className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
                    mode === 'signup'
                      ? 'border border-emerald-300/40 bg-emerald-400/20 text-emerald-100'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>সাইন আপ</span>
                </button>
              </div>

              {mode === 'signin' ? (
                <form onSubmit={handleSignIn} className="space-y-3.5">
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    {isAddingSecondAccount
                      ? 'আপনার দ্বিতীয় অ্যাকাউন্টের ইমেইল ও পাসওয়ার্ড দিন। এরপর এক ক্লিকে দুই অ্যাকাউন্টে সুইচ করতে পারবেন।'
                      : 'সাইন আপ করা দুটি ইমেইলের যেকোনো একটি এবং আপনাদের শেয়ার্ড পাসওয়ার্ড দিয়ে সাইন ইন করুন।'}
                  </p>

                  <div>
                    <label htmlFor="couple-signin-email" className="mb-1 block text-xs text-slate-300">
                      ইমেইল (আপনার বা পার্টনারের)
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        id="couple-signin-email"
                        type="email"
                        required
                        autoFocus
                        value={signInEmail}
                        onChange={(e) => setSignInEmail(e.target.value)}
                        placeholder="example@gmail.com"
                        className="w-full rounded-xl border border-white/15 bg-black/50 py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="couple-signin-password" className="mb-1 block text-xs text-slate-300">
                      পাসওয়ার্ড
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        id="couple-signin-password"
                        type="password"
                        required
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        placeholder="আপনার পাসওয়ার্ড লিখুন..."
                        className="w-full rounded-xl border border-white/15 bg-black/50 py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                      />
                    </div>
                  </div>

                  {errorText && (
                    <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                      <p>{errorText}</p>
                      {isProviderDisabled && (
                        <p className="mt-1 text-[11px] text-amber-200">
                          ধাপ: Firebase Console &rarr; Authentication &rarr; Sign-in method &rarr; Email/Password অন করে Save করুন।
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-300 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-200 disabled:opacity-60"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>{submitting ? 'লগইন হচ্ছে...' : 'সাইন ইন করুন'}</span>
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSignUp} className="space-y-3.5">
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    দুইজনের ইমেইল, নাম, জন্মদিন, সম্পর্কের ধরন ও একটি কমন পাসওয়ার্ড দিয়ে অ্যাকাউন্ট খুলুন।
                  </p>

                  {/* 3 Relationship Options */}
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-slate-200">
                      সম্পর্কের ধরন বেছে নিন
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {RELATIONSHIP_OPTIONS.map((opt) => {
                        const selected = relationshipType === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setRelationshipType(opt.id)}
                            className={`flex flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-all ${
                              selected
                                ? opt.id === 'spouse'
                                  ? 'border-rose-300/60 bg-rose-400/20 text-rose-100'
                                  : opt.id === 'couple'
                                    ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
                                    : 'border-sky-300/60 bg-sky-400/20 text-sky-100'
                                : 'border-white/12 bg-black/40 text-slate-400 hover:border-white/25 hover:text-slate-200'
                            }`}
                          >
                            {opt.id === 'spouse' ? (
                              <HeartHandshake className="mb-1 h-3.5 w-3.5" />
                            ) : opt.id === 'couple' ? (
                              <Heart className="mb-1 h-3.5 w-3.5" />
                            ) : (
                              <Sparkles className="mb-1 h-3.5 w-3.5" />
                            )}
                            <span className="text-[11px] font-semibold leading-tight">
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10.5px] text-slate-400">
                      {RELATIONSHIP_OPTIONS.find((o) => o.id === relationshipType)?.hint}
                    </p>
                  </div>

                  {/* Primary User Info (Email + Name + Birthday) */}
                  <div className="space-y-2 rounded-xl border border-white/10 bg-black/35 p-3">
                    <p className="text-[11px] font-semibold text-emerald-200">আপনার তথ্য</p>
                    <div>
                      <label htmlFor="couple-signup-email1" className="mb-1 block text-[11px] text-slate-300">
                        আপনার ইমেইল
                      </label>
                      <input
                        id="couple-signup-email1"
                        type="email"
                        required
                        value={primaryEmail}
                        onChange={(e) => setPrimaryEmail(e.target.value)}
                        placeholder="your-email@gmail.com"
                        className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/70 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor="couple-signup-name1" className="mb-1 block text-[11px] text-slate-300">
                          আপনার নাম
                        </label>
                        <input
                          id="couple-signup-name1"
                          type="text"
                          required
                          maxLength={60}
                          value={primaryName}
                          onChange={(e) => setPrimaryName(e.target.value)}
                          placeholder="আপনার নাম..."
                          className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/70 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="couple-signup-bday1" className="mb-1 block text-[11px] text-slate-300">
                          আপনার জন্মতারিখ (বার্থডে)
                        </label>
                        <input
                          id="couple-signup-bday1"
                          type="date"
                          required
                          value={primaryBirthday}
                          onChange={(e) => setPrimaryBirthday(e.target.value)}
                          className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white [color-scheme:dark] focus:border-emerald-300/70 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Partner Info (Email + Name + Birthday) */}
                  <div className="space-y-2 rounded-xl border border-white/10 bg-black/35 p-3">
                    <p className="text-[11px] font-semibold text-sky-200">পার্টনারের তথ্য</p>
                    <div>
                      <label htmlFor="couple-signup-email2" className="mb-1 block text-[11px] text-slate-300">
                        পার্টনারের ইমেইল
                      </label>
                      <input
                        id="couple-signup-email2"
                        type="email"
                        required
                        value={partnerEmail}
                        onChange={(e) => setPartnerEmail(e.target.value)}
                        placeholder="partner-email@gmail.com"
                        className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <label htmlFor="couple-signup-name2" className="mb-1 block text-[11px] text-slate-300">
                          পার্টনারের নাম
                        </label>
                        <input
                          id="couple-signup-name2"
                          type="text"
                          required
                          maxLength={60}
                          value={partnerName}
                          onChange={(e) => setPartnerName(e.target.value)}
                          placeholder="পার্টনারের নাম..."
                          className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-sky-300/70 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="couple-signup-bday2" className="mb-1 block text-[11px] text-slate-300">
                          পার্টনারের জন্মতারিখ (বার্থডে)
                        </label>
                        <input
                          id="couple-signup-bday2"
                          type="date"
                          required
                          value={partnerBirthday}
                          onChange={(e) => setPartnerBirthday(e.target.value)}
                          className="w-full rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs text-white [color-scheme:dark] focus:border-sky-300/70 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="couple-signup-pass" className="mb-1 block text-xs text-slate-300">
                        শেয়ার্ড পাসওয়ার্ড
                      </label>
                      <input
                        id="couple-signup-pass"
                        type="password"
                        required
                        minLength={6}
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        placeholder="কমপক্ষে ৬ অক্ষর"
                        className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/70 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="couple-signup-confirm" className="mb-1 block text-xs text-slate-300">
                        পাসওয়ার্ড নিশ্চিত করুন
                      </label>
                      <input
                        id="couple-signup-confirm"
                        type="password"
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="আবার লিখুন"
                        className="w-full rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-300/70 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-amber-300/25 bg-amber-500/10 p-3">
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] text-amber-100">
                      <input
                        type="checkbox"
                        checked={claimLegacyUploads}
                        onChange={(e) => setClaimLegacyUploads(e.target.checked)}
                        className="mt-0.5 rounded border-white/25 accent-amber-300"
                      />
                      <span>
                        পূর্বের আপলোড করা সব গান, ছবি, অডিও ও চিরকুট এই অ্যাকাউন্টে আনতে চাই (নতুন ব্যবহারকারীরা এটি বন্ধ রাখুন)
                      </span>
                    </label>

                    {claimLegacyUploads && (
                      <input
                        type="password"
                        inputMode="numeric"
                        value={legacyPin}
                        onChange={(e) => setLegacyPin(e.target.value)}
                        placeholder="আগের ৪ সংখ্যার গোপন পিন দিন..."
                        className="w-full rounded-lg border border-amber-300/30 bg-black/55 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-amber-200 focus:outline-none"
                      />
                    )}
                  </div>

                  {errorText && (
                    <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                      <p>{errorText}</p>
                      {isProviderDisabled && (
                        <p className="mt-1 text-[11px] text-amber-200">
                          ধাপ: Firebase Console &rarr; Authentication &rarr; Sign-in method &rarr; Email/Password অন করে Save করুন।
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-300 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-200 disabled:opacity-60"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>{submitting ? 'অ্যাকাউন্ট তৈরি হচ্ছে...' : 'দুইজনের অ্যাকাউন্ট তৈরি করুন'}</span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
