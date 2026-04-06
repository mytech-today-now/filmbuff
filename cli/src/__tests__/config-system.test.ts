/**
 * config-system.test.ts — updated for Phase 10 (bd-2d41).
 *
 * Phase 7 (bd-e8ad) renamed the config block from `ai` with url/model/etc.
 * fields to `aiPowered` with shape { plugins: string[], debug: boolean }.
 * The old constants AI_POWERED_DEFAULT_MODEL and AI_POWERED_DEFAULT_URL have
 * been removed from ai-provider-config.ts.
 *
 * These tests verify the Phase 7 aiPowered schema is applied correctly.
 */
import { ConfigManager, DEFAULT_CONFIG } from '../utils/config-system';

describe('ConfigManager — Phase 7 aiPowered schema (bd-e8ad)', () => {
  // -------------------------------------------------------------------------
  // DEFAULT_CONFIG shape
  // -------------------------------------------------------------------------

  it('DEFAULT_CONFIG.aiPowered.plugins defaults to ["audit-log"]', () => {
    expect(DEFAULT_CONFIG.aiPowered?.plugins).toEqual(['audit-log']);
  });

  it('DEFAULT_CONFIG.aiPowered.debug defaults to false', () => {
    expect(DEFAULT_CONFIG.aiPowered?.debug).toBe(false);
  });

  it('DEFAULT_CONFIG.aiPowered has no url field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.url).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no model field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.model).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no temperature field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.temperature).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no maxTokens field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.maxTokens).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no timeoutMs field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.timeoutMs).toBeUndefined();
  });

  it('DEFAULT_CONFIG.aiPowered has no systemPrompt field (removed in Phase 7)', () => {
    expect((DEFAULT_CONFIG.aiPowered as Record<string, unknown>)?.systemPrompt).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Merge behaviour
  // -------------------------------------------------------------------------

  it('mergeConfig deep-merges aiPowered.plugins override', () => {
    const merged = {
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, plugins: ['rate-limiter', 'audit-log'] },
    };
    expect(merged.aiPowered?.plugins).toEqual(['rate-limiter', 'audit-log']);
    // debug should still hold its default value
    expect(merged.aiPowered?.debug).toBe(false);
  });

  it('mergeConfig deep-merges aiPowered.debug override', () => {
    const merged = {
      ...DEFAULT_CONFIG,
      aiPowered: { ...DEFAULT_CONFIG.aiPowered, debug: true },
    };
    expect(merged.aiPowered?.debug).toBe(true);
    expect(merged.aiPowered?.plugins).toEqual(['audit-log']);
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('ConfigManager.validate returns valid for DEFAULT_CONFIG', () => {
    const manager = new ConfigManager();
    const result = manager.validate({ ...DEFAULT_CONFIG });
    expect(result.valid).toBe(true);
  });

  it('ConfigManager.validate returns valid when aiPowered.plugins is empty array', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      aiPowered: { plugins: [], debug: false },
    });
    expect(result.valid).toBe(true);
  });

  it('deprecated ai.provider triggers no schema validation error', () => {
    // The schema marks ai.provider as deprecated but valid — presence alone
    // must not fail validation; only a runtime stderr warning is emitted.
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic' },
    });
    expect(result.valid).toBe(true);
  });
});