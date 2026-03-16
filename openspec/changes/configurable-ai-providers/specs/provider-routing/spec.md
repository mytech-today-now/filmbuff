---
id: changes/configurable-ai-providers/provider-routing
status: approved
relatedTasks: []
relatedRules: [coordination-system.md, no-unnecessary-docs.md]
---

# Spec Delta: Provider Routing

## ADDED Requirements

### Requirement: Active Provider Resolution
FilmBuff SHALL resolve supported AI-powered commands through the active provider/profile selection.

#### Scenario: Execute a supported command
- GIVEN a user has activated a provider profile
- WHEN the user runs `filmbuff generate-shot-list`
- THEN FilmBuff MUST resolve the active provider/profile before execution
- AND the command MUST use the resolved provider adapter rather than hard-coded backend logic

### Requirement: Capability Validation Before Execution
FilmBuff SHALL validate provider compatibility before running a supported command.

#### Scenario: Provider does not support the requested command
- GIVEN the active provider lacks the capability required by the command
- WHEN the command is invoked
- THEN FilmBuff MUST fail before execution
- AND it MUST return an actionable error that explains the capability mismatch

### Requirement: Clear Runtime Validation Errors
FilmBuff SHALL provide actionable errors for invalid provider state.

#### Scenario: Missing credentials or invalid settings
- GIVEN the active profile is missing a required credential or model setting
- WHEN a supported AI-powered command is invoked
- THEN FilmBuff MUST stop before sending a provider request
- AND it MUST report which required input is missing or invalid
- AND it MUST NOT echo secret values in the error output