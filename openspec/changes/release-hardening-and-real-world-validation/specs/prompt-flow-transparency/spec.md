## ADDED Requirements

### Requirement: Release validation covers prompt-flow documentation
Release validation SHALL confirm prompt-flow documentation still matches the implementation.

#### Scenario: Compile and refinement boundaries are documented
- **WHEN** release validation reviews README or linked docs
- **THEN** docs SHALL state that local compilation is mandatory and non-LLM, LLM refinement is optional, safety rewrite is conditional, and the image backend receives the final prompt

#### Scenario: Switch locations are documented
- **WHEN** release validation reviews configuration docs
- **THEN** docs SHALL identify where to configure automatic whole-message generation, automatic extraction, prompt refinement, safety rewrite, backend mode, built-in styles, gallery/history, and message generation buttons

#### Scenario: Known limitations are documented
- **WHEN** release validation prepares the release decision
- **THEN** docs SHALL list remaining limitations or operational risks discovered during validation
