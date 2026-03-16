import { useEffect, useMemo, useState } from 'react';

export type FocusedComponent = 'tree' | 'preview' | 'version' | 'search';

export interface NavigationState {
  currentCategory: string | null;
  currentModule: string | null;
  expandedCategories: Set<string>;
  focusedComponent: FocusedComponent;
}

interface PersistedNavigationState {
  currentCategory: string | null;
  currentModule: string | null;
  expandedCategories: string[];
  focusedComponent: FocusedComponent;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = 'augx_navigation_state';

const DEFAULT_NAVIGATION_STATE: NavigationState = {
  currentCategory: null,
  currentModule: null,
  expandedCategories: new Set<string>(),
  focusedComponent: 'tree'
};

function getStorage(): StorageLike | null {
  const globalObject = globalThis as { localStorage?: StorageLike };
  return globalObject.localStorage ?? null;
}

function isFocusedComponent(value: unknown): value is FocusedComponent {
  return value === 'tree' || value === 'preview' || value === 'version' || value === 'search';
}

function cloneState(state: NavigationState): NavigationState {
  return {
    currentCategory: state.currentCategory,
    currentModule: state.currentModule,
    expandedCategories: new Set(state.expandedCategories),
    focusedComponent: state.focusedComponent
  };
}

export function loadNavigationState(): NavigationState | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedNavigationState>;
    return {
      currentCategory: parsed.currentCategory ?? null,
      currentModule: parsed.currentModule ?? null,
      expandedCategories: new Set(Array.isArray(parsed.expandedCategories) ? parsed.expandedCategories : []),
      focusedComponent: isFocusedComponent(parsed.focusedComponent) ? parsed.focusedComponent : 'tree'
    };
  } catch {
    return null;
  }
}

export function saveNavigationState(state: NavigationState): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const persisted: PersistedNavigationState = {
    currentCategory: state.currentCategory,
    currentModule: state.currentModule,
    expandedCategories: Array.from(state.expandedCategories),
    focusedComponent: state.focusedComponent
  };

  storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export function clearNavigationState(): void {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY);
}

export function useNavigationState() {
  const [state, setState] = useState<NavigationState>(() => loadNavigationState() ?? cloneState(DEFAULT_NAVIGATION_STATE));

  useEffect(() => {
    saveNavigationState(state);
  }, [state]);

  const actions = useMemo(() => ({
    setCurrentCategory(currentCategory: string | null) {
      setState((previous: NavigationState) => ({ ...previous, currentCategory }));
    },
    setCurrentModule(currentModule: string | null) {
      setState((previous: NavigationState) => ({ ...previous, currentModule }));
    },
    toggleCategory(category: string) {
      setState((previous: NavigationState) => {
        const expandedCategories = new Set(previous.expandedCategories);
        if (expandedCategories.has(category)) {
          expandedCategories.delete(category);
        } else {
          expandedCategories.add(category);
        }

        return { ...previous, expandedCategories };
      });
    },
    expandCategory(category: string) {
      setState((previous: NavigationState) => ({
        ...previous,
        expandedCategories: new Set(previous.expandedCategories).add(category)
      }));
    },
    collapseCategory(category: string) {
      setState((previous: NavigationState) => {
        const expandedCategories = new Set(previous.expandedCategories);
        expandedCategories.delete(category);
        return { ...previous, expandedCategories };
      });
    },
    setFocusedComponent(focusedComponent: FocusedComponent) {
      setState((previous: NavigationState) => ({ ...previous, focusedComponent }));
    }
  }), []);

  return [state, actions] as const;
}