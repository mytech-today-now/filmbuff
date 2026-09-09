# Proposal: Add Pika AI video generation as a first-class provider

## Related Beads

- `bd-b184`

## Why

FilmBuff has provider selection, batch validation, serialization, CLI generation, and GUI-facing provider state, but Pika is not represented consistently across those paths. Existing Pika references use placeholder names and do not expose the current Pika REST model catalog or model-specific constraints.

## What Changes

Add Pika as a first-class video provider using the current official API contract. The implementation must use one shared capability source for model IDs, supported operations, option names, enums, and reference limits. The public library and CLI must preserve provider options, reject unsupported options and invalid reference counts, and never emit API keys.

## Scope

- Add the verified Pika model IDs for text-to-video, image-to-video, keyframes, Pikadditions, Pikaswaps, and Pikaffects.
- Add a typed, SDK-free HTTPS adapter for Pika's asynchronous API.
- Integrate Pika capabilities into config loading, live capability fallback, validation, batch serialization, CLI selection, and GUI-facing provider state.
- Add public API types and deterministic tests for option and reference validation.
- Document setup, model selection, option transport, and the deprecated old Pika API distinction.

## Non-goals

- Do not invent undocumented limits, model aliases, SDK methods, or pricing.
- Do not replace the existing ai-powered providers.
- Do not log or serialize API credentials.
- Do not add a second provider capability registry.

## Acceptance criteria

1. Pika appears in the canonical provider capability table with `PIKA_API_KEY`, the official base URL, and all current video model endpoint IDs used by the adapter.
2. Text-to-video, image-to-video, keyframe, Pikadditions, Pikaswaps, and Pikaffects options are represented by typed public API contracts and validated before transport.
3. Unsupported models, unsupported option names, invalid enum values, malformed media references, and invalid reference counts fail with deterministic validation errors.
4. Pika provider options survive shot input, batch serialization, and CLI generation without being silently dropped.
5. CLI provider selection and GUI-facing state derive Pika model choices from the shared capability source.
6. Tests cover primary success paths, unsupported options, zero and maximum reference boundaries, API key non-disclosure, and injected HTTP transport.
7. The applicable TypeScript build, lint, focused tests, and broader regression tests pass, with structured test output saved under the repository test artifact convention.

## Sources

- Official Pika model documentation: `https://dev.pika.art/`
- Official Pika REST examples: `https://dev.pika.art/models/pika/pika-2.5/text-to-video`
- Official Pika deprecation notice: `https://github.com/Pika-Labs/Pika-Skills`
