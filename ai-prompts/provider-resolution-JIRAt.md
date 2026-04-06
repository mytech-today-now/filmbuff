# JIRA Ticket: TBD — Replace `resolveActiveProvider` / `profileStore` JSON Backend with Database-Backed Provider Resolution

## Summary

Retire the current file-based provider resolution system — `cli/src/utils/profile-store.ts` (reads and writes provider profiles as JSON files under `.augment/providers/profiles/`) and the file-reading internals of `cli/src/utils/runtime-resolver.ts` — and replace them with a unified, database-backed implementation backed by `ProviderRepository` and `~/.filmbuff/global.db`. The public API of `resolveActiveProvider()` and `resolveProviderByProfile(providerId, profileName)` is preserved exactly so no command handler requires changes. This ticket is the concrete implementation work that the three sibling specs — `ai-prompts/db-layer-prompt.md`, `ai-prompts/ai-providers-JIRA.md`, and `ai-prompts/film-docs-JIRA.md` — all converge on and depend upon.

---

## Description

### Background — Current State

FilmBuff currently resolves AI providers through two loosely coupled modules:

1. **`cli/src/utils/profile-store.ts` (`profileStore`)** — reads and writes individual JSON files under `.augment/providers/profiles/<provider-id>/<profile-name>.json` and persists the active selection to `.augment/providers/active.json`. All mutation is a full file overwrite; there is no transaction boundary.
2. **`cli/src/utils/runtime-resolver.ts`** — exports two public functions consumed by every AI-powered command:
   - `resolveActiveProvider()` — reads `active.json`, then reads the matching profile JSON, then calls `resolveSecrets()` to substitute environment variables or decrypt ciphertext.
   - `resolveProviderByProfile(providerId, profileName)` — reads a specific profile JSON file, then calls `resolveSecrets()`.

Both functions are already the single mandated entry points for provider resolution. The problem is not their public interface — it is their backing store.

### Why the Current Implementation Must Be Replaced

| Problem | Impact |
|---|---|
| No ACID guarantees | A crash mid-write leaves `active.json` or a profile file in a partial state; the next command fails with a parse error |
| No concurrent-access safety | `filmbuff status` polling while `filmbuff continue` writes can read a half-written file |
| No audit trail | There is no record of when the active provider changed or which profile was used for each generation |
| Incompatible with GUI config | `filmbuff configure` and `filmbuff gui` cannot share a consistent view of state without duplicating file-management logic |
| Incompatible with the database layer | `db-layer-prompt.md` defines `ProviderRepository` as the canonical store; `profileStore` is a parallel, conflicting system |
| Migration complexity | JSON files under `.augment/` are project-adjacent; global provider config belongs in `~/.filmbuff/global.db` separate from any project |

### New Solution — Architecture

The new implementation replaces the JSON file backend while keeping the public resolver API identical.

#### Current Architecture (retired by this ticket)

```
CLI commands
  └─► resolveActiveProvider() / resolveProviderByProfile()   [runtime-resolver.ts]
        └─► profileStore                                      [profile-store.ts]
              └─► JSON files    .augment/providers/profiles/*.json
                                .augment/providers/active.json
```

#### New Architecture (implemented by this ticket)

```
CLI commands
  └─► resolveActiveProvider() / resolveProviderByProfile()   [runtime-resolver.ts — API unchanged]
        └─► ProviderRepository                               [cli/src/db/repositories/provider-repository.ts]
              └─► global.db    ~/.filmbuff/global.db (SQLite WAL, tables: providers + provider_profiles)
```

`resolveSecrets()` is unchanged in both architectures. It continues to be called after repository retrieval to substitute env-var references and decrypt AES-256-GCM ciphertext in-memory.

### Key Changes per File

| File | Change |
|---|---|
| `cli/src/utils/runtime-resolver.ts` | Replace all `profileStore` calls with `ProviderRepository` calls; `resolveSecrets()` call site is unchanged |
| `cli/src/utils/profile-store.ts` | **Deprecated and removed** after migration shim ships and all callers are updated |
| `cli/src/db/repositories/provider-repository.ts` | **New** — implements `ProviderRepository` as defined in `ai-prompts/db-layer-prompt.md § Repository Layer` |
| `cli/src/db/migrations/001_initial_schema.sql` | Creates `providers` and `provider_profiles` tables; seeds built-in providers |
| `cli/src/db/index.ts` | Exports a singleton `ProviderRepository` instance backed by `openGlobalDatabase()` |
| `cli/src/utils/config-system.ts` | Updated to read and write provider config through `ProviderRepository` instead of JSON |
| `cli/src/commands/generate-shot-list.ts` | **No change** — continues to call `resolveActiveProvider()` |
| `cli/src/commands/start.ts` | **No change** — continues to call `resolveActiveProvider()` |
| `cli/src/commands/continue.ts` | **No change** — continues to call `resolveActiveProvider()` |
| `cli/src/commands/retry.ts` | **No change** — continues to call `resolveProviderByProfile()` when override flags supplied |

### `resolveActiveProvider()` — Implementation Delta

```typescript
// BEFORE (file-based)
export function resolveActiveProvider(): ResolvedProvider {
  const active = profileStore.getActiveSelection();          // reads active.json
  const profile = profileStore.getProfile(active.providerId, active.profileName); // reads profile JSON
  return resolveSecrets(profile);
}

// AFTER (database-backed)
export function resolveActiveProvider(): ResolvedProvider {
  const active = providerRepository.getActiveSelection();   // queries global.db
  if (!active) throw new NoActiveProviderError();
  const profile = providerRepository.findProfile(active.providerId, active.profileName);
  if (!profile) throw new ProfileNotFoundError(active.providerId, active.profileName);
  return resolveSecrets(profile);                           // unchanged
}
```

### `resolveProviderByProfile()` — Implementation Delta

```typescript
// BEFORE (file-based)
export function resolveProviderByProfile(providerId: string, profileName: string): ResolvedProvider {
  const profile = profileStore.getProfile(providerId, profileName); // reads profile JSON
  return resolveSecrets(profile);
}

// AFTER (database-backed)
export function resolveProviderByProfile(providerId: string, profileName: string): ResolvedProvider {
  const profile = providerRepository.findProfile(providerId, profileName); // queries global.db
  if (!profile) throw new ProfileNotFoundError(providerId, profileName);
  return resolveSecrets(profile);                                          // unchanged
}
```

### One-Time Migration Shim

On the first call that opens `global.db`, if `~/.filmbuff/global.db` does not yet exist but `.augment/providers/profiles/` does, the connection factory runs the migration shim before returning the connection:

1. Reads all JSON profile files from `.augment/providers/profiles/`.
2. Reads `.augment/providers/active.json` for the current active selection.
3. Inserts all providers and profiles into `global.db` via `ProviderRepository.upsertProvider` and `upsertProfile`.
4. Calls `ProviderRepository.setActiveSelection` if an active selection was found.
5. Writes `.augment/providers/.migrated` sentinel file so this logic never runs twice.
6. Leaves the original JSON files in place for one release cycle; a follow-up migration removes them.

---

## Acceptance Criteria

- `resolveActiveProvider()` returns the same `ResolvedProvider` shape and throws the same error types as before; no command handler requires any changes.
- `resolveProviderByProfile(providerId, profileName)` returns the same shape; per-command override flag behavior is unchanged.
- All provider state is read from and written to `~/.filmbuff/global.db`; no JSON profile files are read at runtime once `global.db` exists.
- `profileStore.ts` is removed; no remaining source file imports from it.
- The one-time migration shim imports all pre-existing JSON profile files into `global.db` on first run; subsequent runs skip the migration (sentinel file check).
- `resolveSecrets()` behavior, signature, and tests are unchanged.
- `filmbuff generate-shot-list`, `filmbuff start`, `filmbuff continue`, `filmbuff retry`, and `filmbuff complete` all pass their existing integration tests without modification.
- `filmbuff configure` and `filmbuff gui` read and write provider state through `ProviderRepository`; no GUI code path touches JSON provider files.
- Per-command `--ai-provider` / `--ai-profile` override resolution calls `resolveProviderByProfile`; the globally active selection in `global.db` is not mutated.
- A `SQLITE_BUSY` error during provider resolution is surfaced as a `DatabaseBusyError` with a user-readable message.
- Unit tests for the refactored `runtime-resolver.ts` use an in-memory SQLite database seeded by the migration runner; no JSON fixture files are read.
- Integration test verifies end-to-end: legacy JSON profile directory → migration shim → `resolveActiveProvider()` returns correct profile → `resolveSecrets()` substitutes credentials → command executes successfully.
- TypeScript strict mode passes with zero `any` usages in `runtime-resolver.ts`, `provider-repository.ts`, and `config-system.ts`.

---

## Implementation Notes

- `ProviderRepository` is a synchronous class (matching `better-sqlite3`'s synchronous API). `resolveActiveProvider` and `resolveProviderByProfile` therefore remain synchronous functions; no `async`/`await` is introduced.
- The `DatabaseContext` singleton (defined in `db-layer-prompt.md`) ensures `global.db` is opened once per process. `ProviderRepository` is instantiated with a reference to this singleton, not with a new connection per call.
- Built-in providers (`anthropic`, `openai`, `google`) are pre-seeded by `001_initial_schema.sql`. A missing built-in provider row is treated as a data-integrity error, not a user-facing `ProfileNotFoundError`.
- The `NoActiveProviderError` thrown when no active selection is found must include a hint pointing the user to `filmbuff provider set` or `filmbuff configure`.

---

## Estimated Effort

| Phase | Deliverable | Hours |
|---|---|---|
| 1 | `ProviderRepository` implementation + unit tests (in-memory SQLite) | 8 |
| 2 | `runtime-resolver.ts` refactor — replace `profileStore` calls | 4 |
| 3 | `config-system.ts` updates | 2 |
| 4 | One-time migration shim | 4 |
| 5 | `profileStore.ts` deprecation — verify zero remaining imports | 2 |
| 6 | Integration tests (legacy JSON → migration → resolver → command) | 6 |
| **Total** | | **26 hours** |

_Note: Phase 1 (`ProviderRepository`) overlaps with `db-layer-prompt.md` Phase 5 (ProviderRepository + secret handling + unit tests, 10 h). These phases should be coordinated to avoid duplicate work._

---

## Related Tickets

- `ai-prompts/db-layer-prompt.md` — defines `ProviderRepository`, `global.db` schema (`providers`, `provider_profiles`), secret-handling strategy, connection factory, and migration system that this ticket implements against
- `ai-prompts/ai-providers-JIRA.md` — defines the provider abstraction, CLI management commands (`filmbuff provider add/list/set/delete/validate`), and GUI config flows that all depend on this ticket's implementation
- `ai-prompts/film-docs-JIRA.md` — defines the ten-step film document pipeline whose every generation step calls `resolveActiveProvider()` or `resolveProviderByProfile()`; pipeline commands are unblocked once this ticket ships

---

## Attachments and References

- Current profile store (to be retired): `cli/src/utils/profile-store.ts`
- Current runtime resolver (to be refactored): `cli/src/utils/runtime-resolver.ts`
- Current config system (to be updated): `cli/src/utils/config-system.ts`
- AI provider types (preserved as canonical): `cli/src/types/ai-providers.ts`
- Database layer spec: `ai-prompts/db-layer-prompt.md`
- Provider abstraction spec: `ai-prompts/ai-providers-JIRA.md`
- Film document pipeline spec: `ai-prompts/film-docs-JIRA.md`
- `better-sqlite3` documentation: https://github.com/WiseLibs/better-sqlite3

