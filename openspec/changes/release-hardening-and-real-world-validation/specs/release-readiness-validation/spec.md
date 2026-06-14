## ADDED Requirements

### Requirement: Release regression checklist
The project SHALL maintain a release regression checklist that covers the primary real-world workflows before release.

#### Scenario: Checklist covers core workflows
- **WHEN** release validation starts
- **THEN** the checklist SHALL include character-card A/B/C library isolation, automatic character extraction, automatic scene extraction, automatic whole-message generation, gallery/history pagination, plugin dialogue bubbles, policy retry, and prompt compile/refine/safety flow

#### Scenario: Checklist records evidence
- **WHEN** a checklist item is executed
- **THEN** the result SHALL record pass, fail, blocked, or not-applicable state with concise evidence or a blocker reference

### Requirement: Prompt-quality sample set
The project SHALL maintain a prompt-quality sample set for release validation.

#### Scenario: Sample is recorded
- **WHEN** a prompt-quality sample is captured
- **THEN** it SHALL include source text, resolved Visual Bible summary, compiled prompt, final backend prompt, diagnostics, and evaluation notes

#### Scenario: Sample avoids heavy artifacts
- **WHEN** generated images are inspected during prompt-quality validation
- **THEN** the sample set SHALL reference lightweight notes or local paths and SHALL NOT commit image bytes to the repository

### Requirement: Release documentation readiness
Release validation SHALL check that user-facing documentation matches current behavior.

#### Scenario: Documentation is reviewed
- **WHEN** release docs are checked
- **THEN** README or linked docs SHALL cover setup, runtime sync, recommended backend settings, default values, role-card Visual Bible behavior, automatic extraction, automatic workflow status, prompt compile/refine/safety flow, known limitations, and troubleshooting

#### Scenario: Version metadata is reviewed
- **WHEN** release readiness is evaluated
- **THEN** `manifest.json` version and README release notes or change summary SHALL be checked for consistency

### Requirement: Verification gates
Release validation SHALL run the required automated and runtime verification gates.

#### Scenario: Automated gates run
- **WHEN** release validation reaches final verification
- **THEN** `openspec validate --specs --strict`, focused Node tests, full available Node tests, and JavaScript syntax checks SHALL be run and recorded

#### Scenario: Runtime gate runs
- **WHEN** local SillyTavern is available
- **THEN** `playwright-cli` SHALL open the local runtime, verify the extension loads, and execute the release regression checklist items that require browser state

### Requirement: Release decision report
Release validation SHALL produce a final release decision.

#### Scenario: Validation completes
- **WHEN** all required gates have been attempted
- **THEN** the final report SHALL state whether the build is release-ready, list residual risks, list any deferred non-blocking issues, and suggest a commit message

#### Scenario: Blocker is found
- **WHEN** validation finds a release-blocking issue
- **THEN** the final report SHALL mark release as blocked until the blocker is fixed and reverified
