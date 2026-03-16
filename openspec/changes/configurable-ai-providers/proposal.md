# Change Proposal: Configurable AI Providers

## Metadata

- **Change ID**: `configurable-ai-providers`
- **Status**: Approved
- **Created**: 2026-03-10
- **Author**: Augment Agent
- **Priority**: High
- **Type**: Architecture, CLI, GUI, and Configuration

## Related JIRA

- Source ticket: [`jira/TBD.md`](./jira/TBD.md)
- Original prompt source: `ai-prompts/ai-providers-JIRA.md`

## Problem Statement

FilmBuff currently treats AI-backed workflows as though they run through one tightly coupled backend. That makes it hard to choose a provider, keep separate credentials for different environments, switch active setups, or extend FilmBuff to community and self-hosted providers.

## Goals

1. Introduce a reusable provider abstraction for AI-powered FilmBuff commands.
2. Support built-in provider setup for Anthropic, OpenAI, and Google AI.
3. Support custom provider registration so new providers do not require a large refactor.
4. Allow multiple named profiles per provider and persist the active selection.
5. Provide management workflows through both `filmbuff configure` and `filmbuff gui`.
6. Keep CLI help/version behavior consistent on new or refactored commands.
7. Validate settings before activation or runtime use while protecting secrets.

## Non-Goals

- Shipping every possible provider in the initial release.
- Designing provider-specific billing or analytics features.
- Changing the user-facing purpose of existing AI-powered commands.
- Defining implementation details for third-party provider packages beyond the extension contract.

## Proposed Change

Create a provider platform that separates provider definitions, provider profiles, active selection, validation, and command execution. Supported FilmBuff AI commands should resolve the active provider/profile automatically, while dedicated CLI and GUI workflows let users add, edit, validate, delete, list, and activate provider profiles.

The change will be defined through three spec deltas:

1. **Provider Registry** - built-in providers, custom providers, profile storage, and secure credential handling.
2. **Provider Routing** - active provider resolution, capability checks, and runtime validation.
3. **Provider Management** - CLI and GUI workflows, including `filmbuff configure` and `filmbuff gui`.

## Success Criteria

- AI-powered commands use the active configured provider/profile.
- Anthropic, OpenAI, and Google AI are supported as built-in providers.
- Users can register custom providers using the same abstraction model.
- Multiple named profiles can be created and switched per provider.
- Provider selection persists across CLI and GUI sessions.
- Help/version flags remain consistent for new management commands.
- Secrets are not exposed in normal output.
- Tests and docs cover configuration, switching, validation, and failure paths.

## Risks and Mitigations

- **Provider API drift**: isolate vendor behavior behind adapters.
- **Secret leakage**: centralize credential masking and storage rules.
- **UX fragmentation**: share the same provider domain model between CLI and GUI.
- **Capability mismatch**: validate provider capabilities before command execution.

## Dependencies

- Existing CLI command framework
- Existing GUI entry points for `filmbuff configure` and `filmbuff gui`
- A durable configuration and secret-storage mechanism

## Next Steps

1. Review the proposal and design.
2. Approve the spec deltas.
3. Break implementation into Beads issues if execution is approved.
4. Implement provider platform, routing, and user management flows.