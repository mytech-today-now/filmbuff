# pika-video-provider Specification

## Purpose
TBD - created by archiving change pika-video-provider. Update Purpose after archive.
## Requirements
### Requirement: Shared Pika capability source

The system SHALL expose one shared Pika capability definition containing the provider ID, display name, `PIKA_API_KEY`, official API base URL, default model, supported model IDs, request operation, option names, enum values, and model-specific media reference limits.

#### Scenario: Capability consumers agree

- GIVEN the CLI config loader, provider capability fallback, and GUI provider state are loaded
- WHEN each asks for Pika video models
- THEN each returns the same model IDs and model-specific reference limits from the shared definition

### Requirement: Typed current Pika requests

The public library SHALL expose typed request contracts for text-to-video, image-to-video, keyframes, Pikadditions, Pikaswaps, and both documented Pikaffects operations.

#### Scenario: Build a valid keyframe request

- GIVEN two through five HTTPS image URLs and a keyframe model
- WHEN the request is validated
- THEN validation succeeds and the payload preserves the URLs and options

### Requirement: Strict validation

The system SHALL reject unknown model IDs, unknown option names, invalid enum values, malformed media URLs, missing required media inputs, and model-specific reference counts outside documented bounds before transport.

#### Scenario: Reject an unsupported option

- GIVEN a valid Pika model and an option name not documented for that model
- WHEN validation runs
- THEN it returns a blocking error naming the option and model

#### Scenario: Enforce keyframe boundaries

- GIVEN the keyframe model
- WHEN zero or one image is supplied
- THEN validation fails because at least two images are required
- WHEN six images are supplied
- THEN validation fails because no more than five images are accepted

### Requirement: Async REST transport

The Pika adapter SHALL submit requests with `X-API-Key`, poll the documented job endpoint, and return the completed content URL without exposing the API key.

#### Scenario: Injected transport submission

- GIVEN a valid request and an injected fetch function
- WHEN submission runs
- THEN the adapter sends the documented URL, method, headers, and JSON body to the injected function

### Requirement: Selection and round trip

The CLI, GUI-facing state, public API, shot input, and batch serializer SHALL preserve the selected Pika model and provider options.

#### Scenario: Serialize Pika options

- GIVEN a shot with Pika provider, model, references, and provider options
- WHEN it is serialized
- THEN the resulting batch item contains all of those values and no credentials
