# Fix: Update Anthropic Model Registry in ai-powered

## Repository
`G:\_kyle\temp_documents\GitHub\ai-powered`

## Problem

The Anthropic provider in `src/ai-powered/providers/anthropic.ts` only lists
Claude 3.x models. FilmBuff's documentation and config reference Claude 4.x
model IDs (`claude-sonnet-4-6`, `claude-opus-4-5`, `claude-haiku-3-5`), but
these are absent from `ANTHROPIC_MODELS` and therefore fail at runtime when
the Anthropic provider is asked to validate or route to them.

Additionally, `DEFAULT_TEXT_MODEL` points to the outdated
`claude-3-5-sonnet-20241022` instead of the current `claude-sonnet-4-6`.

## Files to Change

### 1. `src/ai-powered/providers/anthropic.ts`

**Current `ANTHROPIC_MODELS` array (lines 35–66):**
```typescript
const ANTHROPIC_MODELS: ModelDescriptor[] = [
  { id: "claude-3-5-sonnet-20241022", ... },
  { id: "claude-3-5-haiku-20241022",  ... },
  { id: "claude-3-opus-20240229",     ... },
  { id: "claude-3-sonnet-20240229",   ... },
  { id: "claude-3-haiku-20240307",    ... },
];
const DEFAULT_TEXT_MODEL = "claude-3-5-sonnet-20241022";
```

**Replace with (prepend Claude 4.x entries, update default):**
```typescript
const ANTHROPIC_MODELS: ModelDescriptor[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
  },
  {
    id: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
  },
  {
    id: "claude-haiku-3-5",
    name: "Claude Haiku 3.5",
    capabilities: ["text", "structured"],
    contextWindow: 200000,
  },
  // Legacy Claude 3.x models — kept for backward compatibility
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", capabilities: ["text", "structured"], contextWindow: 200000 },
  { id: "claude-3-5-haiku-20241022",  name: "Claude 3.5 Haiku",  capabilities: ["text", "structured"], contextWindow: 200000 },
  { id: "claude-3-opus-20240229",     name: "Claude 3 Opus",     capabilities: ["text", "structured"], contextWindow: 200000 },
  { id: "claude-3-sonnet-20240229",   name: "Claude 3 Sonnet",   capabilities: ["text", "structured"], contextWindow: 200000 },
  { id: "claude-3-haiku-20240307",    name: "Claude 3 Haiku",    capabilities: ["text", "structured"], contextWindow: 200000 },
];

const DEFAULT_TEXT_MODEL = "claude-sonnet-4-6";
```

## Acceptance Criteria

- [ ] `ANTHROPIC_MODELS` contains `claude-sonnet-4-6`, `claude-opus-4-5`,
      and `claude-haiku-3-5` as the leading entries.
- [ ] All existing Claude 3.x entries are retained (backward compat).
- [ ] `DEFAULT_TEXT_MODEL` is updated to `"claude-sonnet-4-6"`.
- [ ] Existing unit/integration tests pass without modification.
- [ ] `listModels("text")` for the Anthropic provider returns the new models.

## Provider Fallback Order (for reference)

Per the FilmBuff spec, the fallback chain for text AI must end with `mock`.
Example `fallbackProviders` value in `.ai-powered/config.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "fallbackProviders": ["openai", "mock"]
}
```

The `mock` provider MUST always be the last entry in any fallback chain.
No other provider should appear after `mock`.

## Related Files (no changes needed, for context only)
- `src/ai-powered/core.ts` — `ProviderNameSchema` already includes `"anthropic"`
- `src/ai-powered/providers/index.ts` — `AnthropicProvider` already registered
- `filmbuff/filmbuff.config.json` — already updated to `claude-sonnet-4-6`
- `filmbuff/cli/src/lib/filmbuff-config.ts` — already updated to `claude-sonnet-4-6`
