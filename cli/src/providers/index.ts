/**
 * Providers public API
 *
 * Re-exports the registry singleton and all shared types.
 * Import built-in adapters only via this barrel — never reference
 * cli/src/providers/builtin/* directly from command handlers.
 *
 * Satisfies: bd-prov-b1, bd-prov-b2
 */

export { ProviderRegistry, DuplicateProviderError, defaultRegistry } from './ProviderRegistry.js';
export type { AdapterEntry, ProviderAdapter, GenerateOptions, GenerateResult } from './types.js';

// Trigger self-registration of all built-in adapters
import './builtin/anthropic.js';
import './builtin/openai.js';
import './builtin/google.js';

