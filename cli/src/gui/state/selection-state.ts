import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectionState {
  selectedModule: string | null;
  selectedVersion: string | null;
  availableVersions: string[];
  isLoading: boolean;
  error: string | null;
}

interface PersistedSelectionState {
  selectedModule: string | null;
  selectedVersion: string | null;
  availableVersions: string[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = 'augx_selection_state';

const DEFAULT_SELECTION_STATE: SelectionState = {
  selectedModule: null,
  selectedVersion: null,
  availableVersions: [],
  isLoading: false,
  error: null
};

function getStorage(): StorageLike | null {
  const globalObject = globalThis as { localStorage?: StorageLike };
  return globalObject.localStorage ?? null;
}

function cloneState(state: SelectionState): SelectionState {
  return {
    selectedModule: state.selectedModule,
    selectedVersion: state.selectedVersion,
    availableVersions: [...state.availableVersions],
    isLoading: state.isLoading,
    error: state.error
  };
}

export function loadSelectionState(): SelectionState | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedSelectionState>;
    return {
      selectedModule: parsed.selectedModule ?? null,
      selectedVersion: parsed.selectedVersion ?? null,
      availableVersions: Array.isArray(parsed.availableVersions) ? parsed.availableVersions : [],
      isLoading: false,
      error: null
    };
  } catch {
    return null;
  }
}

export function saveSelectionState(state: SelectionState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const persisted: PersistedSelectionState = {
    selectedModule: state.selectedModule,
    selectedVersion: state.selectedVersion,
    availableVersions: [...state.availableVersions]
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function clearSelectionState(): void {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY);
}

export function useSelectionState() {
  const [state, setState] = useState<SelectionState>(() => loadSelectionState() ?? cloneState(DEFAULT_SELECTION_STATE));
  const skipNextPersist = useRef(false);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }

    saveSelectionState(state);
  }, [state]);

  const actions = useMemo(() => ({
    selectModule(selectedModule: string | null) {
      setState((previous: SelectionState) => ({
        ...previous,
        selectedModule,
        selectedVersion: null,
        availableVersions: [],
        error: null
      }));
    },
    selectVersion(selectedVersion: string | null) {
      setState((previous: SelectionState) => ({ ...previous, selectedVersion }));
    },
    setAvailableVersions(availableVersions: string[]) {
      setState((previous: SelectionState) => ({ ...previous, availableVersions: [...availableVersions] }));
    },
    setLoading(isLoading: boolean) {
      setState((previous: SelectionState) => ({ ...previous, isLoading }));
    },
    setError(error: string | null) {
      setState((previous: SelectionState) => ({ ...previous, error }));
    },
    clearSelection() {
      skipNextPersist.current = true;
      clearSelectionState();
      setState(cloneState(DEFAULT_SELECTION_STATE));
    }
  }), []);

  return [state, actions] as const;
}