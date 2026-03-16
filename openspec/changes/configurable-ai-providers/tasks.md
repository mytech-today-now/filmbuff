# Tasks: Configurable AI Providers

## Phase 1: Specification Approval

- [x] Review `proposal.md`, `design.md`, and `tests.md` with stakeholders.
- [x] Confirm change boundaries and non-goals.
- [x] Approve the provider-registry, provider-routing, and provider-management spec deltas.

## Phase 2: Provider Platform Foundation

- [x] Define provider registry interfaces and adapter contract.
- [ ] Define profile storage model and active-selection state.
- [ ] Choose secure secret handling strategy for supported environments.
- [ ] Implement built-in provider metadata for Anthropic, OpenAI, and Google AI.

## Phase 3: Extensibility and Validation

- [ ] Add custom provider registration flow.
- [ ] Implement provider/profile validation before activation.
- [ ] Implement capability checks before command execution.
- [ ] Add redaction rules for logs, diagnostics, and normal CLI output.

## Phase 4: Runtime and User Workflows

- [ ] Refactor supported AI-powered commands to resolve the active provider/profile.
- [ ] Add CLI workflows to list, create, edit, validate, delete, and activate profiles.
- [ ] Implement `filmbuff configure` guided setup.
- [ ] Extend `filmbuff gui` with provider-management views and active-profile status.

## Phase 5: Documentation and Verification

- [ ] Publish user docs for setup, switching, and troubleshooting.
- [ ] Add automated tests for routing, persistence, help/version behavior, and failure paths.
- [ ] Run verification against supported AI-powered commands.
- [ ] Prepare Beads implementation tasks if the change moves to execution.