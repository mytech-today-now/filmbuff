import { DEFAULT_AI_MODEL, DEFAULT_AI_PROVIDER } from '../utils/ai-provider-config';
import { ConfigManager, DEFAULT_CONFIG } from '../utils/config-system';

describe('ConfigManager AI provider settings', () => {
  it('should include default AI provider and model in DEFAULT_CONFIG', () => {
    expect(DEFAULT_CONFIG.ai?.provider).toBe(DEFAULT_AI_PROVIDER);
    expect(DEFAULT_CONFIG.ai?.model).toBe(DEFAULT_AI_MODEL);
  });

  it('should warn for unsupported AI providers', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      ai: {
        ...DEFAULT_CONFIG.ai,
        provider: 'openai'
      }
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain(
      'ai.provider "openai" is not implemented for shot list generation yet. Currently implemented providers: anthropic'
    );
  });

  it('should error for a blank AI model', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      ai: {
        ...DEFAULT_CONFIG.ai,
        model: '   '
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ai.model must be a non-empty string');
  });

  it('should error for a blank AI provider', () => {
    const manager = new ConfigManager();
    const result = manager.validate({
      ...DEFAULT_CONFIG,
      ai: {
        ...DEFAULT_CONFIG.ai,
        provider: '   '
      }
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ai.provider must be a non-empty string');
  });
});