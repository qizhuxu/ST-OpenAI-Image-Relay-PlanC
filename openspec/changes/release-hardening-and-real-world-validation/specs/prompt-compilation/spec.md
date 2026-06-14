## ADDED Requirements

### Requirement: Release validation captures prompt-flow evidence
Release validation SHALL capture evidence that the prompt pipeline is understandable and stable.

#### Scenario: Compile evidence is captured
- **WHEN** a sample source text is validated
- **THEN** release evidence SHALL include the local compiled prompt and Visual Bible summary before any optional refinement

#### Scenario: Final prompt evidence is captured
- **WHEN** optional refinement or safety rewrite changes a prompt
- **THEN** release evidence SHALL record which prompt was finally sent or would be sent to the image backend

#### Scenario: Prompt quality is evaluated
- **WHEN** a prompt-quality sample is reviewed
- **THEN** validation SHALL evaluate character consistency, scene consistency, missing fixed appearances, safety rewrite impact, and prompt clarity
