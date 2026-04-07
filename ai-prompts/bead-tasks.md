bd-94mp	Screenplay Writing Standards Extension	epic
bd-modinsp.1	Module Inspection – Phase 1: Foundation & Architecture	task
bd-modinsp.1.1	Module Inspection – Project Setup	task
bd-modinsp.2	Module Inspection – Phase 2: Language Parsers	task
bd-modinsp.3	Module Inspection – Phase 3: Inspection Engine	task
bd-modinsp.3.1	Content Inspector (parsers all closed)	task
bd-modinsp.3.2	Dependency Analyzer (parsers all closed)	task
bd-modinsp.7	Module Inspection – Phase 7: Testing & Documentation	task
bd-modinsp.7.2	Integration Tests (all blockers closed)	task
bd-modinsp.7.3	Documentation (all blockers closed)	task
bd-modinsp.4.2	JSON Formatter	bd-modinsp.3.1
bd-modinsp.7.1	Unit Tests	bd-modinsp.3.1, .4.1, .4.2, .4.3
bd-modinsp.3.3	Security Scanner (parsers all closed)	task
bd-modinsp.4	Module Inspection – Phase 4: Report Generation	task
bd-modinsp.5	Module Inspection – Phase 5: VS Code Integration	task
bd-tcey	AI: Replace AI Abstraction with ai-powered (37h)	epic
bd-f9wn	AI Phase 3 – Core Client Implementation 6h (bd-9uc4 closed)	task
bd-gbwj	AI Phase 3.1 – Types, Interfaces & Error Classes 1h	task
bd-vlrl	AI Phase 3.2 – checkHealth() w/ Exponential Backoff 2h	task
bd-6cf4	[ai-powered-not-local] Phase 3: Deletion Pass (bd-3854 closed)	task
bd-ai-providers.3	Define profile storage, active selection & secret handling	task
bd-470f	[ai-powered-not-local] Phase 1: Specification Approval (now closed — verify)	task
bd-modinsp.4.1	Text Formatter	bd-modinsp.3.1
bd-modinsp.4.3	Markdown Formatter	bd-modinsp.3.1
bd-modinsp.7.4	Performance Testing	bd-modinsp.3.1, .3.2, .3.3
bd-ai-providers.4	Add built-in providers & custom provider registration	bd-ai-providers.3
bd-ai-providers.5	Validation, capability checks, redaction	bd-ai-providers.3, .4
bd-ai-providers.6	Route AI-powered commands through active provider	bd-ai-providers.4, .5
bd-ai-providers.7	CLI provider management & guided configure flow	bd-ai-providers.4, .5
bd-ai-providers.8	Extend filmbuff GUI with provider management	bd-ai-providers.4, .5
bd-r9sf	AI Phase 4 – Factory & Call Sites 4h	bd-f9wn
bd-08b4	AI Phase 5 – Config Schema Update 3h	bd-r9sf
bd-zdru	AI Phase 6 – CLI Changes 9h	bd-08b4
bd-6sg7	AI Phase 7 – Test Rewrite 6h	bd-zdru
bd-024w	AI Phase 9 – Verification & Acceptance	bd-4g4l
bd-6d52	[aipnl] Phase 4: Central Wrapper Implementation	bd-6cf4
bd-551f	[aipnl] Phase 5: Extractor Migration	bd-6d52
bd-cfa7	[aipnl] Phase 6: Runtime Resolver Replacement	bd-6d52
bd-e8ad	[aipnl] Phase 7: Config Schema Update	bd-6d52
bd-6c4f	[aipnl] Phase 8: Video Generation Implementation	bd-551f, bd-cfa7, bd-e8ad
bd-99b2	[aipnl] Phase 9: CLI Changes	bd-551f, bd-cfa7, bd-e8ad
bd-2d41	[aipnl] Phase 10: Test Rewrite & Extension	bd-6c4f, bd-99b2
bd-3807	[aipnl] Phase 11: Documentation	bd-99b2
bd-7b0b	[aipnl] Phase 12: Verification & Acceptance	bd-2d41, bd-3807
bd-modinsp.4.4	Webview Integration	bd-modinsp.4.1, .4.2, .4.3
bd-4g4l	AI Phase 8 – Documentation 2h	bd-6sg7
bd-ai-providers.9	Docs, tests & verify provider workflows	bd-ai-providers.6, .7, .8