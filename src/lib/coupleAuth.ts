import { deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  UserCredential,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  AUTHORIZED_BOX_ID,
  derivePinToken,
  generateCoupleBoxId,
  verifyWritePin,
} from './chirkutCrypto';
import {
  AccountSlotIndex,
  createSecondaryFirebaseApp,
  FIREBASE_DATABASE_ID,
  getActiveSlotIndex,
  getSlotAuth,
  getSlotDb,
  handleFirestoreError,
  OperationType,
} from './firebase';

export type RelationshipType = 'ex' | 'spouse' | 'couple';

export const RELATIONSHIP_LABELS_BN: Record<RelationshipType, string> = {
  ex: 'এক্স (প্রাক্তন)',
  spouse: 'ওয়াইফ / হাজবেন্ড',
  couple: 'প্রেমিক-প্রেমিকা (কাপল)',
};

export interface CoupleWorkspace {
  uid: string;
  boxId: string;
  selfEmail: string;
  partnerEmail: string;
  selfName: string;
  partnerName: string;
  selfBirthday: string;
  partnerBirthday: string;
  relationshipType: RelationshipType;
  createdAtMs: number;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 160;
}

export function isValidBirthDateString(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
}

export function parseRelationshipType(raw: unknown): RelationshipType {
  if (raw === 'spouse' || raw === 'couple' || raw === 'ex') {
    return raw;
  }
  return 'ex';
}

export function formatBirthdayDisplayBn(dateStr?: string): string {
  if (!dateStr || !isValidBirthDateString(dateStr)) return '';
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('bn-BD', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(dt);
  } catch {
    return dateStr;
  }
}

export function mapFirebaseAuthErrorBn(err: unknown): {
  message: string;
  isProviderDisabled?: boolean;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return {
      isProviderDisabled: true,
      message:
        'Firebase Console থেকে Email/Password লগইন এখনো চালু করা হয়নি। Firebase Console > Authentication > Sign-in method থেকে Email/Password চালু করুন।',
    };
  }
  if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use')) {
    return {
      message:
        'এই ইমেইলগুলোর একটিতে ইতোমধ্যেই অ্যাকাউন্ট খোলা আছে। অনুগ্রহ করে সাইন ইন করুন অথবা অন্য ইমেইল দিন।',
    };
  }
  if (code === 'auth/invalid-email') {
    return { message: 'ইমেইলের ধরন সঠিক নয়। অনুগ্রহ করে সঠিক ইমেইল দিন।' };
  }
  if (code === 'auth/weak-password') {
    return { message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' };
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return { message: 'ইমেইল বা পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।' };
  }
  if (code === 'auth/too-many-requests') {
    return { message: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' };
  }
  if (code === 'auth/network-request-failed') {
    return { message: 'ইন্টারনেট সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।' };
  }
  if (msg.includes('permission-denied') || msg.includes('already-exists')) {
    return {
      message:
        'পূর্বের আপলোডগুলো ইতোমধ্যেই একটি অ্যাকাউন্টে যুক্ত আছে অথবা অনুমতি পাওয়া যায়নি।',
    };
  }

  return {
    message: err instanceof Error ? err.message : 'অ্যাকাউন্ট প্রক্রিয়াটি সম্পন্ন করা যায়নি।',
  };
}

export async function fetchUserWorkspace(
  uid: string,
  slotIndex: AccountSlotIndex = getActiveSlotIndex()
): Promise<CoupleWorkspace | null> {
  if (!uid) return null;
  const targetDb = getSlotDb(slotIndex);
  const targetAuth = getSlotAuth(slotIndex);
  const path = `user_workspaces/${uid}`;
  try {
    const snap = await getDoc(doc(targetDb, 'user_workspaces', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (!d || typeof d.boxId !== 'string') return null;
    return {
      uid: typeof d.uid === 'string' ? d.uid : uid,
      boxId: d.boxId,
      selfEmail: typeof d.selfEmail === 'string' ? d.selfEmail : '',
      partnerEmail: typeof d.partnerEmail === 'string' ? d.partnerEmail : '',
      selfName: typeof d.selfName === 'string' ? d.selfName : '',
      partnerName: typeof d.partnerName === 'string' ? d.partnerName : '',
      selfBirthday: typeof d.selfBirthday === 'string' ? d.selfBirthday : '',
      partnerBirthday: typeof d.partnerBirthday === 'string' ? d.partnerBirthday : '',
      relationshipType: parseRelationshipType(d.relationshipType),
      createdAtMs: d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path, targetAuth);
  }
}

export interface SignUpCoupleParams {
  primaryEmail: string;
  primaryName: string;
  primaryBirthday: string;
  partnerEmail: string;
  partnerName: string;
  partnerBirthday: string;
  relationshipType: RelationshipType;
  password: string;
  claimLegacyUploads: boolean;
  legacyPin?: string;
}

export async function signUpCouple(
  params: SignUpCoupleParams,
  slotIndex: AccountSlotIndex = getActiveSlotIndex()
): Promise<CoupleWorkspace> {
  const primary = normalizeEmail(params.primaryEmail);
  const partner = normalizeEmail(params.partnerEmail);
  const primaryName = params.primaryName.trim().slice(0, 60);
  const partnerName = params.partnerName.trim().slice(0, 60);
  const primaryBirthday = params.primaryBirthday.trim();
  const partnerBirthday = params.partnerBirthday.trim();
  const relationshipType = parseRelationshipType(params.relationshipType);
  const password = params.password;
  const cleanPin = (params.legacyPin || '').trim();

  if (!isValidEmailAddress(primary)) {
    throw new Error('আপনার ইমেইলটি সঠিক নয়।');
  }
  if (!primaryName) {
    throw new Error('আপনার নাম লিখুন।');
  }
  if (!isValidBirthDateString(primaryBirthday)) {
    throw new Error('আপনার জন্মতারিখ (বার্থডে) দিন।');
  }
  if (!isValidEmailAddress(partner)) {
    throw new Error('পার্টনারের ইমেইলটি সঠিক নয়।');
  }
  if (!partnerName) {
    throw new Error('পার্টনারের নাম লিখুন।');
  }
  if (!isValidBirthDateString(partnerBirthday)) {
    throw new Error('পার্টনারের জন্মতারিখ (বার্থডে) দিন।');
  }
  if (primary === partner) {
    throw new Error('আপনার এবং পার্টনারের জন্য দুটি আলাদা ইমেইল দিন।');
  }
  if (password.length < 6) {
    throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
  }
  if (params.claimLegacyUploads && !verifyWritePin(cleanPin)) {
    throw new Error('পূর্বের আপলোড যুক্ত করতে সঠিক ৪ সংখ্যার পিন দিন।');
  }

  const slotAuth = getSlotAuth(slotIndex);
  const slotDb = getSlotDb(slotIndex);

  const boxId = params.claimLegacyUploads ? AUTHORIZED_BOX_ID : generateCoupleBoxId();
  const legacyToken = params.claimLegacyUploads ? derivePinToken(cleanPin) : null;

  let primaryCred: UserCredential | null = null;
  let partnerCred: UserCredential | null = null;
  const secondaryApp = createSecondaryFirebaseApp(`vtr-signup-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  const secondaryDb = getFirestore(secondaryApp, FIREBASE_DATABASE_ID);

  try {
    primaryCred = await createUserWithEmailAndPassword(slotAuth, primary, password);
    partnerCred = await createUserWithEmailAndPassword(secondaryAuth, partner, password);

    const uid1 = primaryCred.user.uid;
    const uid2 = partnerCred.user.uid;

    const batch = writeBatch(slotDb);
    const boxPayload: Record<string, unknown> = {
      id: boxId,
      ownerUid: uid1,
      memberUids: [uid1, uid2],
      relationshipType,
      createdAt: serverTimestamp(),
    };
    if (legacyToken) {
      boxPayload.legacyClaimPinToken = legacyToken;
    }

    batch.set(doc(slotDb, 'chirkut_boxes', boxId), boxPayload);
    batch.set(doc(slotDb, 'user_workspaces', uid1), {
      uid: uid1,
      boxId,
      selfEmail: primary,
      partnerEmail: partner,
      selfName: primaryName,
      partnerName,
      selfBirthday: primaryBirthday,
      partnerBirthday,
      relationshipType,
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    await setDoc(doc(secondaryDb, 'user_workspaces', uid2), {
      uid: uid2,
      boxId,
      selfEmail: partner,
      partnerEmail: primary,
      selfName: partnerName,
      partnerName: primaryName,
      selfBirthday: partnerBirthday,
      partnerBirthday: primaryBirthday,
      relationshipType,
      createdAt: serverTimestamp(),
    });

    return {
      uid: uid1,
      boxId,
      selfEmail: primary,
      partnerEmail: partner,
      selfName: primaryName,
      partnerName,
      selfBirthday: primaryBirthday,
      partnerBirthday,
      relationshipType,
      createdAtMs: Date.now(),
    };
  } catch (err) {
    if (partnerCred?.user) {
      await partnerCred.user.delete().catch(() => undefined);
    }
    if (primaryCred?.user) {
      await primaryCred.user.delete().catch(() => undefined);
    }
    throw err;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export async function signInCoupleMember(
  params: {
    email: string;
    password: string;
  },
  slotIndex: AccountSlotIndex = getActiveSlotIndex()
): Promise<CoupleWorkspace | null> {
  const email = normalizeEmail(params.email);
  if (!isValidEmailAddress(email)) {
    throw new Error('অনুগ্রহ করে সঠিক ইমেইল দিন।');
  }
  if (!params.password) {
    throw new Error('পাসওয়ার্ড দিন।');
  }
  const slotAuth = getSlotAuth(slotIndex);
  const cred = await signInWithEmailAndPassword(slotAuth, email, params.password);
  return fetchUserWorkspace(cred.user.uid, slotIndex);
}

export async function signOutCoupleMember(
  slotIndex: AccountSlotIndex = getActiveSlotIndex()
): Promise<void> {
  await signOut(getSlotAuth(slotIndex));
}
