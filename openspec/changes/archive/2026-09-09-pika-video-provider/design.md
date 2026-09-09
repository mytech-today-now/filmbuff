# Design: Pika video provider integration

## Architecture

`cli/src/lib/provider-capabilities.ts` is the canonical source for video provider metadata. It contains Pika model IDs, API paths, operations, required and optional fields, enum values, numeric constraints, and media reference limits. The public `ai-powered` module re-exports this source, while CLI configuration and GUI provider choices consume it directly instead of maintaining independent Pika lists.

`ai-powered/src/pika.ts` exposes typed request unions, validation, payload construction, asynchronous submission, status polling, and content URL extraction. The transport accepts an injected `fetch` implementation so tests do not call Pika and credentials are supplied only through an explicit client option or `PIKA_API_KEY` lookup.

CLI validation applies the shared Pika validator after provider and model resolution. Existing non-Pika warning behavior remains unchanged. Pika reference counts are model-specific and blocking because silently ignoring keyframes or media inputs would change the requested output.

Batch items carry an optional `providerOptions` object. The serializer copies it without transforming fields, while the Pika validator checks it before export. API keys are rejected by the existing payload safety assertion and are never part of a shot or batch type.

The GUI checkout has provider panel state but no rendered provider component. The state module therefore exposes a pure model-choice selector backed by the shared capability table and persists the selected model ID alongside the existing provider selection.

## Verified model contracts

The implementation uses these official model IDs:

- `pika/pika-2.5/text-to-video`
- `pika/pika-2.5/image-to-video`
- `pika/pikaframes/image-to-video`
- `pika/pikadditions/video-to-video`
- `pika/pikaswaps/video-to-video`
- `pika/pikaffects/image-to-video`
- `pika/pikaffects/video-to-video`

The adapter posts to `https://api.dev.pika.art/v1/media/{model-id}` with `X-API-Key` and polls `/v1/media/jobs/{request_id}`. The content endpoint is used only after a completed job. No provider SDK is added because the official documentation specifies plain HTTPS requests.

## Security and failure behavior

- Missing Pika credentials fail before a network request.
- Credential values are not included in errors, logs, manifests, or serialized batch data.
- Pika URL inputs must be absolute HTTPS URLs. The existing batch reference map continues to allow its established HTTPS or image data URI contract, but the Pika adapter rejects data URIs because Pika's documented remote media fields require URLs.
- Unknown option names and invalid values fail before transport.
- Polling has a timeout and bounded delay. HTTP failures preserve status information without echoing authorization headers or request bodies containing secrets.

## Test harness

The canonical harness is the existing Jest suite for CLI integration and the existing Vitest suite for the standalone `ai-powered` source. Pika HTTP tests inject a deterministic fetch stub and use fixed request data. The harness writes a JSON report to `test-results/pika-video-provider.json` containing assertions, environment, commit, duration, and final status. No live Pika credentials or external requests are used.
