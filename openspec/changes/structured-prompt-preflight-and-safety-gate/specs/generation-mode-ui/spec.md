## ADDED Requirements

### Requirement: Prompt template categories are explicit
The prompt-template UI SHALL distinguish required templates, compatibility controls, advanced post-processing templates, and inactive or deprecated templates.

#### Scenario: User opens prompt templates
- **WHEN** the user opens the prompt-template area
- **THEN** the UI SHALL label backend prompt templates and planner templates as required runtime controls
- **AND** it SHALL label main prompt injection and extraction regex as legacy or compatibility controls for `<pic>` workflows
- **AND** it SHALL label refinement, safety rewrite, and summarization templates as advanced post-processing controls

#### Scenario: Cleanup template is shown
- **WHEN** the cleanup template remains visible
- **THEN** the UI SHALL clearly mark it as inactive/reserved and SHALL NOT imply that it currently affects prompt cleanup

#### Scenario: Cleanup template is removed or hidden
- **WHEN** the cleanup template is hidden or removed from normal UI
- **THEN** existing saved cleanup template values SHALL NOT break settings loading or prompt generation

### Requirement: Prompt flow diagnostics are visible
The workbench SHALL expose concise preflight diagnostics without overwhelming the image preview.

#### Scenario: Preflight runs
- **WHEN** a generation plan or job completes preflight
- **THEN** the folded logs, progress item, history item, or console diagnostics SHALL show compile, optional refinement, safety classification, rewrite, validation, and final prompt source summary

#### Scenario: Refinement is rejected
- **WHEN** an optional refinement candidate is rejected by validation
- **THEN** the UI or console diagnostics SHALL show a concise reason such as protected character loss, scene loss, or dialogue policy violation
