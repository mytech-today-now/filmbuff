---
id: changes/configurable-ai-providers/provider-registry
status: approved
relatedTasks: []
relatedRules: [coordination-system.md, no-unnecessary-docs.md]
---

# Spec Delta: Provider Registry

## ADDED Requirements

### Requirement: Built-in and Custom Provider Registration
FilmBuff SHALL expose a provider registry that supports built-in and user-defined AI providers through the same core abstraction.

#### Scenario: Register a built-in provider
- GIVEN FilmBuff starts with built-in providers enabled
- WHEN the provider registry is initialized
- THEN Anthropic, OpenAI, and Google AI MUST be registered as available providers
- AND each provider MUST declare its required settings and capabilities

#### Scenario: Register a custom provider
- GIVEN a user adds a custom provider definition
- WHEN the definition matches the provider contract
- THEN the registry MUST persist and load that provider without changing command handlers
- AND the custom provider MUST participate in the same validation flow as built-in providers

### Requirement: Multiple Named Profiles Per Provider
FilmBuff SHALL support multiple named profiles for a single provider.

#### Scenario: Save multiple profiles for one provider
- GIVEN a user configures personal and work credentials for OpenAI
- WHEN both profiles are saved
- THEN FilmBuff MUST preserve both profiles independently
- AND profile selection MUST be explicit by provider and profile name

### Requirement: Secure Provider Configuration Storage
FilmBuff SHALL store provider settings durably while protecting secrets.

#### Scenario: Persist provider credentials
- GIVEN a provider profile includes API credentials
- WHEN the profile is saved
- THEN non-secret settings MUST be stored durably
- AND secrets MUST be stored securely or referenced securely
- AND secrets MUST NOT be displayed in normal output