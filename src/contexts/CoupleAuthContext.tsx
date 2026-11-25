import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  CoupleWorkspace,
  fetchUserWorkspace,
  RelationshipType,
  signOutCoupleMember,
} from '../lib/coupleAuth';
import {
  AccountSlotIndex,
  getActiveSlotIndex,
  getSlotAuth,
  setActiveSlotIndex as persistActiveSlotIndex,
} from '../lib/firebase';

export interface AccountSlotState {
  slotIndex: AccountSlotIndex;
  user: User | null;
  workspace: CoupleWorkspace | null;
  authReady: boolean;
  workspaceLoading: boolean;
}

interface CoupleAuthContextValue {
  activeSlotIndex: AccountSlotIndex;
  slots: [AccountSlotState, AccountSlotState];
  user: User | null;
  workspace: CoupleWorkspace | null;
  activeBoxId: string | null;
  relationshipType: RelationshipType;
  authReady: boolean;
  workspaceLoading: boolean;
  switchAccountSlot: (slotIndex: AccountSlotIndex) => void;
  setSlotWorkspaceDirect: (slotIndex: AccountSlotIndex, ws: CoupleWorkspace | null) => void;
  setWorkspaceDirect: (ws: CoupleWorkspace | null) => void;
  refreshWorkspace: (slotIndex?: AccountSlotIndex) => Promise<void>;
  signOutSlot: (slotIndex: AccountSlotIndex) => Promise<void>;
  signOutAll: () => Promise<void>;
  signOut: () => Promise<void>;
}

const makeInitialSlot = (slotIndex: AccountSlotIndex): AccountSlotState => ({
  slotIndex,
  user: getSlotAuth(slotIndex).currentUser,
  workspace: null,
  authReady: false,
  workspaceLoading: false,
});

const CoupleAuthContext = createContext<CoupleAuthContextValue>({
  activeSlotIndex: 0,
  slots: [makeInitialSlot(0), makeInitialSlot(1)],
  user: null,
  workspace: null,
  activeBoxId: null,
  relationshipType: 'ex',
  authReady: false,
  workspaceLoading: false,
  switchAccountSlot: () => undefined,
  setSlotWorkspaceDirect: () => undefined,
  setWorkspaceDirect: () => undefined,
  refreshWorkspace: async () => undefined,
  signOutSlot: async () => undefined,
  signOutAll: async () => undefined,
  signOut: async () => undefined,
});

export function CoupleAuthProvider({ children }: { children: React.ReactNode }) {
  const [activeSlotIndex, setActiveSlotState] = useState<AccountSlotIndex>(() =>
    getActiveSlotIndex()
  );
  const [slots, setSlots] = useState<[AccountSlotState, AccountSlotState]>(() => [
    makeInitialSlot(0),
    makeInitialSlot(1),
  ]);

  const updateSlot = useCallback(
    (slotIndex: AccountSlotIndex, patch: Partial<AccountSlotState>) => {
      setSlots((prev) => {
        const next: [AccountSlotState, AccountSlotState] = [{ ...prev[0] }, { ...prev[1] }];
        next[slotIndex] = { ...next[slotIndex], ...patch };
        return next;
      });
    },
    []
  );

  const loadWorkspaceForSlot = useCallback(
    async (slotIndex: AccountSlotIndex, uid: string | null) => {
      if (!uid) {
        updateSlot(slotIndex, { workspace: null, workspaceLoading: false });
        return;
      }
      updateSlot(slotIndex, { workspaceLoading: true });
      try {
        const ws = await fetchUserWorkspace(uid, slotIndex);
        updateSlot(slotIndex, { workspace: ws });
      } catch (err) {
        console.warn('Workspace lookup notice:', err instanceof Error ? err.message : err);
        updateSlot(slotIndex, { workspace: null });
      } finally {
        updateSlot(slotIndex, { workspaceLoading: false });
      }
    },
    [updateSlot]
  );

  useEffect(() => {
    const unsub0 = onAuthStateChanged(getSlotAuth(0), (nextUser) => {
      updateSlot(0, { user: nextUser, authReady: true });
      void loadWorkspaceForSlot(0, nextUser?.uid ?? null);
    });
    const unsub1 = onAuthStateChanged(getSlotAuth(1), (nextUser) => {
      updateSlot(1, { user: nextUser, authReady: true });
      void loadWorkspaceForSlot(1, nextUser?.uid ?? null);
    });
    return () => {
      unsub0();
      unsub1();
    };
  }, [loadWorkspaceForSlot, updateSlot]);

  // If the currently active slot is signed out while the other slot is signed in, seamlessly focus the signed-in slot
  useEffect(() => {
    if (!slots[0].authReady || !slots[1].authReady) return;
    const other: AccountSlotIndex = activeSlotIndex === 0 ? 1 : 0;
    if (!slots[activeSlotIndex].user && slots[other].user) {
      persistActiveSlotIndex(other);
      setActiveSlotState(other);
    }
  }, [activeSlotIndex, slots]);

  const switchAccountSlot = useCallback((slotIndex: AccountSlotIndex) => {
    persistActiveSlotIndex(slotIndex);
    setActiveSlotState(slotIndex);
  }, []);

  const setSlotWorkspaceDirect = useCallback(
    (slotIndex: AccountSlotIndex, ws: CoupleWorkspace | null) => {
      updateSlot(slotIndex, { workspace: ws });
    },
    [updateSlot]
  );

  const setWorkspaceDirect = useCallback(
    (ws: CoupleWorkspace | null) => {
      setSlotWorkspaceDirect(activeSlotIndex, ws);
    },
    [activeSlotIndex, setSlotWorkspaceDirect]
  );

  const refreshWorkspace = useCallback(
    async (slotIndex: AccountSlotIndex = activeSlotIndex) => {
      const uid = getSlotAuth(slotIndex).currentUser?.uid ?? null;
      await loadWorkspaceForSlot(slotIndex, uid);
    },
    [activeSlotIndex, loadWorkspaceForSlot]
  );

  const signOutSlot = useCallback(
    async (slotIndex: AccountSlotIndex) => {
      await signOutCoupleMember(slotIndex);
      updateSlot(slotIndex, { user: null, workspace: null });
      const other: AccountSlotIndex = slotIndex === 0 ? 1 : 0;
      if (getSlotAuth(other).currentUser) {
        persistActiveSlotIndex(other);
        setActiveSlotState(other);
      }
    },
    [updateSlot]
  );

  const signOutAll = useCallback(async () => {
    await Promise.all([signOutCoupleMember(0), signOutCoupleMember(1)]);
    updateSlot(0, { user: null, workspace: null });
    updateSlot(1, { user: null, workspace: null });
    persistActiveSlotIndex(0);
    setActiveSlotState(0);
  }, [updateSlot]);

  const signOut = useCallback(async () => {
    await signOutSlot(activeSlotIndex);
  }, [activeSlotIndex, signOutSlot]);

  const activeSlot = slots[activeSlotIndex];

  return (
    <CoupleAuthContext.Provider
      value={{
        activeSlotIndex,
        slots,
        user: activeSlot.user,
        workspace: activeSlot.workspace,
        activeBoxId: activeSlot.workspace?.boxId ?? null,
        relationshipType: activeSlot.workspace?.relationshipType ?? 'ex',
        authReady: activeSlot.authReady,
        workspaceLoading: activeSlot.workspaceLoading,
        switchAccountSlot,
        setSlotWorkspaceDirect,
        setWorkspaceDirect,
        refreshWorkspace,
        signOutSlot,
        signOutAll,
        signOut,
      }}
    >
      {children}
    </CoupleAuthContext.Provider>
  );
}

export function useCoupleAuth(): CoupleAuthContextValue {
  return useContext(CoupleAuthContext);
}
