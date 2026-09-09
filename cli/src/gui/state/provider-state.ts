/**
 * Provider State (GUI)
 *
 * Persists and restores the provider management panel state in the filmbuff
 * GUI (webview / TUI navigation layer).  Mirrors the navigation-state.ts
 * pattern so the GUI framework can drive provider CRUD views the same way it
 * drives module inspection views.
 *
 * Satisfies: bd-ai-providers.8 – Phase 4: Extend filmbuff GUI with provider
 *            management
 */

import {
  SHARED_VIDEO_PROVIDER_CAPABILITIES,
  type VideoModelCapability
} from '../../lib/provider-capabilities.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderPanelView =
  | 'list'          // Provider & profile list (default)
  | 'create'        // Create-profile form
  | 'edit'          // Edit-profile form
  | 'show'          // Profile detail view (read-only)
  | 'validate'      // Inline validation results
  | 'confirm-delete'; // Delete confirmation dialog

export interface ProviderPanelState {
  /** Which sub-view is displayed. */
  activeView: ProviderPanelView;
  /** Provider ID currently selected in the list or form. */
  selectedProviderId: string | null;
  /** Video model currently selected in the provider picker. */
  selectedModelId: string | null;
  /** Profile name currently selected or being edited/created. */
  selectedProfileName: string | null;
  /** Whether the provider panel is expanded (vs. collapsed). */
  expanded: boolean;
  /** Transient status message to show in the panel footer. */
  statusMessage: string | null;
}

// ---------------------------------------------------------------------------
// Defaults and storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'filmbuff_provider_panel_state';

export const DEFAULT_PROVIDER_PANEL_STATE: ProviderPanelState = {
  activeView: 'list',
  selectedProviderId: null,
  selectedModelId: null,
  selectedProfileName: null,
  expanded: true,
  statusMessage: null,
};

// ---------------------------------------------------------------------------
// Persistence helpers (localStorage – used in webview context)
// ---------------------------------------------------------------------------

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): StorageLike | null {
  const g = globalThis as { localStorage?: StorageLike };
  return g.localStorage ?? null;
}

export function loadProviderPanelState(): ProviderPanelState {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_PROVIDER_PANEL_STATE };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROVIDER_PANEL_STATE };
    return { ...DEFAULT_PROVIDER_PANEL_STATE, ...(JSON.parse(raw) as Partial<ProviderPanelState>) };
  } catch {
    return { ...DEFAULT_PROVIDER_PANEL_STATE };
  }
}

export function saveProviderPanelState(state: ProviderPanelState): void {
  const storage = getStorage();
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearProviderPanelState(): void {
  getStorage()?.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Action creators (pure reducers – usable in both React and non-React contexts)
// ---------------------------------------------------------------------------

export function setProviderPanelView(
  state: ProviderPanelState,
  view: ProviderPanelView
): ProviderPanelState {
  return { ...state, activeView: view };
}

export function selectProviderProfile(
  state: ProviderPanelState,
  providerId: string | null,
  profileName: string | null
): ProviderPanelState {
  return {
    ...state,
    selectedProviderId: providerId,
    selectedModelId: providerId === state.selectedProviderId ? state.selectedModelId : null,
    selectedProfileName: profileName
  };
}

export interface VideoProviderChoice {
  id: string;
  displayName: string;
  defaultModel: string;
  models: VideoModelCapability[];
}

/** Return GUI video provider choices from the canonical capability table. */
export function getVideoProviderChoices(): VideoProviderChoice[] {
  return SHARED_VIDEO_PROVIDER_CAPABILITIES
    .filter(provider => provider.videoSupport)
    .map(provider => ({
      id: provider.id,
      displayName: provider.displayName,
      defaultModel: provider.defaultModel,
      models: provider.models.map(model => ({
        ...model,
        requiredOptions: [...model.requiredOptions],
        supportedOptions: [...model.supportedOptions]
      }))
    }));
}

export function selectVideoProviderModel(
  state: ProviderPanelState,
  modelId: string | null
): ProviderPanelState {
  return { ...state, selectedModelId: modelId };
}

export function toggleProviderPanel(state: ProviderPanelState): ProviderPanelState {
  return { ...state, expanded: !state.expanded };
}

export function setProviderStatusMessage(
  state: ProviderPanelState,
  message: string | null
): ProviderPanelState {
  return { ...state, statusMessage: message };
}

export function resetProviderPanel(state: ProviderPanelState): ProviderPanelState {
  return { ...state, ...DEFAULT_PROVIDER_PANEL_STATE };
}
