/**
 * Configuration System for Augment Extensions
 * Provides configuration file support with validation and defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeAIProvider } from './ai-provider-config';

const BUILTIN_PROMPT_NAMES = ['code-review', 'module-summary', 'optimization', 'refactoring'];

/**
 * Deep-clone plain config trees so each manager owns its own mutable state.
 */
function cloneConfigTree<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneConfigTree(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      cloned[key] = cloneConfigTree(nestedValue);
    }
    return cloned as T;
  }

  return value;
}

export interface PromptTemplateConfig {
  name: string;
  description: string;
  template: string;
}

export interface AISummaryCacheConfig {
  enabled?: boolean;
  ttlSeconds?: number;
  directory?: string;
  retryAttempts?: number;
}

/**
 * Configuration interface
 */
export interface AugmentConfig {
  /** Configuration version */
  version: string;
  /** Plugin configuration */
  plugins?: {
    /** Enable/disable plugins */
    enabled?: boolean;
    /** Plugin directory */
    directory?: string;
    /** Auto-load plugins */
    autoLoad?: boolean;
  };
  /** Inspection configuration */
  inspection?: {
    /** Default output format */
    defaultFormat?: 'text' | 'json' | 'markdown';
    /** Enable caching */
    cache?: boolean;
    /** Cache TTL in seconds */
    cacheTTL?: number;
    /** Max depth for recursive inspection */
    maxDepth?: number;
    /** Default page size for paginated output */
    pageSize?: number;
    /** Enable secure redaction mode by default */
    secureMode?: boolean;
    /** Enable syntax highlighting for supported outputs */
    syntaxHighlighting?: boolean;
  };
  /** Module configuration */
  modules?: {
    /** Module search paths */
    searchPaths?: string[];
    /** Auto-discover modules */
    autoDiscover?: boolean;
    /** Linked modules manifest path */
    linkedModulesFile?: string;
  };
  /** Hook configuration */
  hooks?: {
    /** Enable/disable hooks */
    enabled?: boolean;
    /** Hook timeout in milliseconds */
    timeout?: number;
  };
  /** Custom handlers */
  handlers?: {
    /** Handler configurations */
    [key: string]: unknown;
  };
  /** VS Code integration */
  vscode?: {
    /** Enable clickable file links */
    enableFileLinks?: boolean;
    /** Open files in preview mode */
    openInPreview?: boolean;
    /** Enable webview features */
    webviewEnabled?: boolean;
  };
  /**
   * Legacy AI integration block.
   * @deprecated Use `aiPowered` instead. Detection of `ai.provider` at runtime
   *   emits a one-time deprecation warning and the value is ignored.
   */
  ai?: {
    /** @deprecated Ignored — FilmBuff now uses ai-powered. */
    provider?: string;
    /** @deprecated Ignored — FilmBuff now uses ai-powered. */
    model?: string;
    /** Enable prompt generation */
    enablePromptGeneration?: boolean;
    /** Enable AI summaries */
    enableSummaries?: boolean;
    /** Default prompt template name */
    defaultPromptTemplate?: string;
    /** Custom prompt templates */
    promptTemplates?: PromptTemplateConfig[];
    /** Summary cache configuration */
    summaryCache?: AISummaryCacheConfig;
  };
  /**
   * ai-powered gateway integration settings (Phase 5 — bd-08b4 / Phase 6 — bd-zdru).
   *
   * The six AIPoweredClientOptions fields (url → timeoutMs) are written here
   * by `filmbuff ai set <key> <value>` and read by resolveAIClient() as
   * Level 3 in the four-level resolution chain:
   *   CLI overrides > env vars > THIS block > built-in defaults
   *
   * FilmBuff does not manage API credentials (apiKey / secret / token).
   * Those are owned exclusively by the ai-powered gateway.
   */
  aiPowered?: {
    /**
     * Plugins to activate for every ai-powered call.
     * Default: ['audit-log'] — traces every AI call per toolName.
     */
    plugins?: string[];
    /**
     * Enable ai-powered debug/verbose logging.
     * Default: false.
     */
    debug?: boolean;
    /** Gateway base URL.  Default: http://localhost:3001 */
    url?: string;
    /** Model identifier forwarded to the gateway.  Default: gpt-4 */
    model?: string;
    /** System prompt injected into every completion request. */
    systemPrompt?: string;
    /** Sampling temperature (0–2).  Default: 0.7 */
    temperature?: number;
    /** Maximum tokens per response.  Default: 2048 */
    maxTokens?: number;
    /** Request timeout in milliseconds.  Default: 30 000 */
    timeoutMs?: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: AugmentConfig = {
  version: '1.0.0',
  plugins: {
    enabled: true,
    directory: '.augment/plugins',
    autoLoad: true
  },
  inspection: {
    defaultFormat: 'text',
    cache: true,
    cacheTTL: 3600,
    maxDepth: 5,
    pageSize: 10,
    secureMode: false,
    syntaxHighlighting: true
  },
  modules: {
    searchPaths: ['filmbuff'],
    autoDiscover: true,
    linkedModulesFile: '.augment/extensions.json'
  },
  hooks: {
    enabled: true,
    timeout: 5000
  },
  handlers: {},
  vscode: {
    enableFileLinks: true,
    openInPreview: false,
    webviewEnabled: true
  },
  // ai.provider / ai.model intentionally omitted from DEFAULT_CONFIG (bd-08b4).
  // The ai block is kept only for non-provider keys that remain valid.
  ai: {
    enablePromptGeneration: true,
    enableSummaries: true,
    defaultPromptTemplate: 'module-summary',
    promptTemplates: [],
    summaryCache: {
      enabled: true,
      ttlSeconds: 3600,
      directory: '.augment/cache/ai-summaries',
      retryAttempts: 1
    }
  },
  // Phase 7 (bd-e8ad): FilmBuff owns only plugins and debug in the aiPowered
  // block. Provider, model, API keys, and URL are managed by ai-powered.
  aiPowered: {
    plugins: ['audit-log'],
    debug:   false,
  }
};

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Configuration manager
 */
export class ConfigManager {
  private config: AugmentConfig;
  private configPath: string;

  constructor(configPath: string = '.augment/augment.json') {
    this.configPath = configPath;
    this.config = cloneConfigTree(DEFAULT_CONFIG);
  }

  /**
   * Load configuration from file
   */
  load(): AugmentConfig {
    if (!fs.existsSync(this.configPath)) {
      return this.config;
    }

    try {
      const fileContent = fs.readFileSync(this.configPath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      // Phase 5 (bd-08b4): emit a one-time deprecation warning when the
      // legacy `ai.provider` key is present in the loaded config file.
      if (
        loadedConfig &&
        typeof loadedConfig === 'object' &&
        'ai' in loadedConfig &&
        typeof (loadedConfig as Record<string, unknown>).ai === 'object' &&
        (loadedConfig as Record<string, Record<string, unknown>>).ai?.provider !== undefined
      ) {
        process.stderr.write(
          'Warning: The "ai.provider" config key is no longer supported. ' +
          'FilmBuff now uses ai-powered.\n' +
          'Run "filmbuff ai set url <url>" to configure your ai-powered server, ' +
          'or use the defaults.\n'
        );
      }

      // Merge with defaults
      this.config = this.mergeConfig(DEFAULT_CONFIG, loadedConfig);

      return this.config;
    } catch (error) {
      console.error(`Failed to load configuration from ${this.configPath}:`, error);
      return this.config;
    }
  }

  /**
   * Save configuration to file
   */
  save(config?: AugmentConfig): void {
    const configToSave = config || this.config;

    // Ensure directory exists
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2) + '\n');
  }

  /**
   * Get current configuration
   */
  getConfig(): AugmentConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AugmentConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
  }

  /**
   * Validate configuration
   */
  validate(config: AugmentConfig = this.config): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate version
    if (!config.version) {
      errors.push('Missing required field: version');
    }

    // Validate inspection format
    if (config.inspection?.defaultFormat) {
      const validFormats = ['text', 'json', 'markdown'];
      if (!validFormats.includes(config.inspection.defaultFormat)) {
        errors.push(`Invalid inspection.defaultFormat: ${config.inspection.defaultFormat}. Must be one of: ${validFormats.join(', ')}`);
      }
    }

    // Validate cache TTL
    if (config.inspection?.cacheTTL !== undefined) {
      if (typeof config.inspection.cacheTTL !== 'number' || config.inspection.cacheTTL < 0) {
        errors.push('inspection.cacheTTL must be a positive number');
      }
    }

    // Validate max depth
    if (config.inspection?.maxDepth !== undefined) {
      if (typeof config.inspection.maxDepth !== 'number' || config.inspection.maxDepth < 1 || config.inspection.maxDepth > 10) {
        errors.push('inspection.maxDepth must be a number between 1 and 10');
      }
    }

    // Validate hook timeout
    if (config.hooks?.timeout !== undefined) {
      if (typeof config.hooks.timeout !== 'number' || config.hooks.timeout < 0) {
        errors.push('hooks.timeout must be a positive number');
      }
    }

    // Validate plugin directory
    if (config.plugins?.directory) {
      if (typeof config.plugins.directory !== 'string') {
        errors.push('plugins.directory must be a string');
      }
    }

    if (config.vscode) {
      for (const field of ['enableFileLinks', 'openInPreview', 'webviewEnabled'] as const) {
        const value = config.vscode[field];
        if (value !== undefined && typeof value !== 'boolean') {
          errors.push(`vscode.${field} must be a boolean`);
        }
      }
    }

    if (config.ai) {
      if (config.ai.provider !== undefined) {
        // Phase 5 (bd-08b4): ai.provider is deprecated; emit advisory warning only.
        // isImplementedAIProvider / IMPLEMENTED_AI_PROVIDERS removed from ai-provider-config.
        const normalizedProvider = normalizeAIProvider(config.ai.provider);
        if (!normalizedProvider) {
          warnings.push(
            'ai.provider is deprecated (bd-08b4). Use the aiPowered block to configure the ai-powered server.'
          );
        } else {
          warnings.push(
            `ai.provider "${config.ai.provider}" is deprecated (bd-08b4) and will be ignored at runtime. ` +
            'Use the aiPowered block instead.'
          );
        }
      }

      if (config.ai.model !== undefined) {
        // Phase 5 (bd-08b4): ai.model is deprecated; advisory warning only.
        warnings.push(
          'ai.model is deprecated (bd-08b4). Use aiPowered.model instead.'
        );
      }

      for (const field of ['enablePromptGeneration', 'enableSummaries'] as const) {
        const value = config.ai[field];
        if (value !== undefined && typeof value !== 'boolean') {
          errors.push(`ai.${field} must be a boolean`);
        }
      }

      if (config.ai.defaultPromptTemplate !== undefined) {
        if (typeof config.ai.defaultPromptTemplate !== 'string' || config.ai.defaultPromptTemplate.trim() === '') {
          errors.push('ai.defaultPromptTemplate must be a non-empty string');
        }
      }

      const customTemplateNames = new Set<string>();
      if (config.ai.promptTemplates !== undefined) {
        if (!Array.isArray(config.ai.promptTemplates)) {
          errors.push('ai.promptTemplates must be an array');
        } else {
          config.ai.promptTemplates.forEach((template, index) => {
            const prefix = `ai.promptTemplates[${index}]`;
            if (!template || typeof template !== 'object') {
              errors.push(`${prefix} must be an object`);
              return;
            }

            if (typeof template.name !== 'string' || template.name.trim() === '') {
              errors.push(`${prefix}.name must be a non-empty string`);
            } else if (customTemplateNames.has(template.name)) {
              errors.push(`${prefix}.name duplicates another custom prompt template: ${template.name}`);
            } else {
              customTemplateNames.add(template.name);
            }

            if (typeof template.description !== 'string' || template.description.trim() === '') {
              errors.push(`${prefix}.description must be a non-empty string`);
            }

            if (typeof template.template !== 'string' || template.template.trim() === '') {
              errors.push(`${prefix}.template must be a non-empty string`);
            }
          });
        }
      }

      if (config.ai.summaryCache) {
        const { enabled, ttlSeconds, directory, retryAttempts } = config.ai.summaryCache;
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          errors.push('ai.summaryCache.enabled must be a boolean');
        }
        if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds < 0)) {
          errors.push('ai.summaryCache.ttlSeconds must be a non-negative number');
        }
        if (directory !== undefined && typeof directory !== 'string') {
          errors.push('ai.summaryCache.directory must be a string');
        }
        if (retryAttempts !== undefined && (!Number.isInteger(retryAttempts) || retryAttempts < 0)) {
          errors.push('ai.summaryCache.retryAttempts must be a non-negative integer');
        }
      }

      if (config.ai.defaultPromptTemplate) {
        const availableTemplateNames = new Set([...BUILTIN_PROMPT_NAMES, ...customTemplateNames]);
        if (!availableTemplateNames.has(config.ai.defaultPromptTemplate)) {
          warnings.push(`ai.defaultPromptTemplate is not a built-in or configured custom template: ${config.ai.defaultPromptTemplate}`);
        }
      }
    }

    // Validate aiPowered block  (bd-08b4 / bd-zdru Phase 5)
    if (config.aiPowered) {
      const ap = config.aiPowered;
      if (ap.url !== undefined && typeof ap.url !== 'string') {
        errors.push('aiPowered.url must be a string');
      }
      if (ap.model !== undefined && typeof ap.model !== 'string') {
        errors.push('aiPowered.model must be a string');
      }
      if (ap.systemPrompt !== undefined && typeof ap.systemPrompt !== 'string') {
        errors.push('aiPowered.systemPrompt must be a string');
      }
      if (ap.temperature !== undefined) {
        if (typeof ap.temperature !== 'number' || ap.temperature < 0 || ap.temperature > 2) {
          errors.push('aiPowered.temperature must be a number between 0 and 2');
        }
      }
      if (ap.maxTokens !== undefined) {
        if (!Number.isInteger(ap.maxTokens) || ap.maxTokens < 1) {
          errors.push('aiPowered.maxTokens must be a positive integer');
        }
      }
      if (ap.timeoutMs !== undefined) {
        if (!Number.isInteger(ap.timeoutMs) || ap.timeoutMs < 1) {
          errors.push('aiPowered.timeoutMs must be a positive integer');
        }
      }
      if (ap.plugins !== undefined && !Array.isArray(ap.plugins)) {
        errors.push('aiPowered.plugins must be an array');
      }
      if (ap.debug !== undefined && typeof ap.debug !== 'boolean') {
        errors.push('aiPowered.debug must be a boolean');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Generate default configuration file
   */
  generateDefault(): void {
    this.save(DEFAULT_CONFIG);
  }

  /**
   * Merge two configurations (deep merge)
   */
  private mergeConfig(base: AugmentConfig, override: Partial<AugmentConfig>): AugmentConfig {
    const merged = cloneConfigTree(base);

    merged.version = override.version || merged.version;

    if (override.plugins !== undefined) {
      merged.plugins = cloneConfigTree({
        ...merged.plugins,
        ...override.plugins
      });
    }

    if (override.inspection !== undefined) {
      merged.inspection = cloneConfigTree({
        ...merged.inspection,
        ...override.inspection
      });
    }

    if (override.modules !== undefined) {
      merged.modules = cloneConfigTree({
        ...merged.modules,
        ...override.modules,
        searchPaths: override.modules.searchPaths ?? merged.modules?.searchPaths
      });
    }

    if (override.hooks !== undefined) {
      merged.hooks = cloneConfigTree({
        ...merged.hooks,
        ...override.hooks
      });
    }

    if (override.handlers !== undefined) {
      merged.handlers = cloneConfigTree({
        ...merged.handlers,
        ...override.handlers
      });
    }

    if (override.vscode !== undefined) {
      merged.vscode = cloneConfigTree({
        ...merged.vscode,
        ...override.vscode
      });
    }

    if (override.ai !== undefined) {
      merged.ai = cloneConfigTree({
        ...merged.ai,
        ...override.ai,
        promptTemplates: override.ai.promptTemplates ?? merged.ai?.promptTemplates,
        summaryCache: {
          ...merged.ai?.summaryCache,
          ...override.ai.summaryCache
        }
      });
    }

    if (override.aiPowered !== undefined) {
      merged.aiPowered = cloneConfigTree({
        ...merged.aiPowered,
        ...override.aiPowered,
        // Prefer override plugins array if provided; fall back to base.
        plugins: override.aiPowered.plugins ?? merged.aiPowered?.plugins,
      });
    }

    return merged;
  }

  /**
   * Get configuration value by path
   */
  get(path: string): any {
    const parts = path.split('.');
    let value: any = this.config;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Set configuration value by path
   */
  set(path: string, value: any): void {
    const parts = path.split('.');
    let current: any = this.config;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }
}

/**
 * Global configuration manager instance
 */
export const configManager = new ConfigManager();

