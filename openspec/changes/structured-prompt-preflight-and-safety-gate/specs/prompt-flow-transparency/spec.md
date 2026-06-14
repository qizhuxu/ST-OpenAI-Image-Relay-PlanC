## ADDED Requirements

### Requirement: Prompt flow docs describe preflight authority
Documentation SHALL describe Prompt Preflight as the required pre-backend authority for prompt preparation.

#### Scenario: User reads README
- **WHEN** the user reads the prompt compilation, refinement, or safety sections of README
- **THEN** the documentation SHALL state that compilation/preflight is mandatory, LLM refinement is optional, safety classification is mandatory, and safety rewrite is conditional on risk or policy retry

#### Scenario: Developer reads docs
- **WHEN** a developer reads the prompt-flow documentation or OpenSpec design
- **THEN** the documentation SHALL identify `prompt_preflight.mjs`, `prompt_compiler.mjs`, PromptDraft diagnostics, protected references, and final backend prompt source order

### Requirement: Template docs distinguish active and inactive controls
Documentation SHALL explain which prompt-template controls are required, compatibility-only, advanced, or inactive.

#### Scenario: User reviews template settings
- **WHEN** the user wants to know which templates are necessary
- **THEN** README or related docs SHALL identify backend templates, multi/comic/analysis templates, extraction regexes, main prompt injection, refinement template, safety template, summarize template, and cleanup template by current runtime role
