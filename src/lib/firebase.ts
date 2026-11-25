import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { doc, Firestore, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export type AccountSlotIndex = 0 | 1;

const ACTIVE_SLOT_STORAGE_KEY = 'vtr_active_account_slot_v1';

const primaryApp = initializeApp(firebaseConfig);
const secondarySlotApp = initializeApp(firebaseConfig, 'vtr-account-slot-1');

export const FIREBASE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

const slot0Auth = getAuth(primaryApp);
const slot0Db = getFirestore(primaryApp, FIREBASE_DATABASE_ID);

const slot1Auth = getAuth(secondarySlotApp);
const slot1Db = getFirestore(secondarySlotApp, FIREBASE_DATABASE_ID);

export const db = slot0Db;
export const auth = slot0Auth;

function readInitialSlotIndex(): AccountSlotIndex {
  if (typeof window === 'undefined') return 0;
  try {
    return window.localStorage.getItem(ACTIVE_SLOT_STORAGE_KEY) === '1' ? 1 : 0;
  } catch {
    return 0;
  }
}

let currentActiveSlot: AccountSlotIndex = readInitialSlotIndex();

export function getActiveSlotIndex(): AccountSlotIndex {
  return currentActiveSlot;
}

export function setActiveSlotIndex(slot: AccountSlotIndex): void {
  currentActiveSlot = slot;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, String(slot));
    } catch {
      // ignore storage errors
    }
  }
}

export function getSlotAuth(slot: AccountSlotIndex): Auth {
  return slot === 1 ? slot1Auth : slot0Auth;
}

export function getSlotDb(slot: AccountSlotIndex): Firestore {
  return slot === 1 ? slot1Db : slot0Db;
}

export function getActiveAuth(): Auth {
  return getSlotAuth(currentActiveSlot);
}

export function getActiveDb(): Firestore {
  return getSlotDb(currentActiveSlot);
}

export function createSecondaryFirebaseApp(name: string): FirebaseApp {
  return initializeApp(firebaseConfig, name);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  targetAuth: Auth = getActiveAuth()
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: targetAuth.currentUser?.uid ?? null,
      email: targetAuth.currentUser?.email ?? null,
      emailVerified: targetAuth.currentUser?.emailVerified ?? null,
      isAnonymous: targetAuth.currentUser?.isAnonymous ?? null,
      tenantId: targetAuth.currentUser?.tenantId ?? null,
      providerInfo:
        targetAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(slot0Db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
