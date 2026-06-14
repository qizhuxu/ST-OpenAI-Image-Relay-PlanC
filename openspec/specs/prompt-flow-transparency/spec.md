# prompt-flow-transparency Specification

## Purpose
Documents and labels the image prompt pipeline so local compilation, optional LLM refinement, safety rewriting, and the final backend prompt source are distinct.

## Requirements
### Requirement: Prompt flow documentation
The extension SHALL document the final image prompt flow and distinguish local compilation from optional LLM refinement.

#### Scenario: User reads prompt-flow documentation
- **WHEN** the user reads README or the dedicated prompt-flow documentation
- **THEN** the documentation SHALL state that local compilation is a mandatory non-LLM assembly step
- **AND** it SHALL state that LLM prompt refinement is optional and controlled by `optimizeEnabled`, `optimizeAuto`, or manual refinement actions
- **AND** it SHALL state that safety rewrite is optional or strategy-driven by safety settings and policy retry behavior

#### Scenario: Developer inspects prompt-flow documentation
- **WHEN** a developer inspects README or the dedicated prompt-flow documentation
- **THEN** the documentation SHALL identify `prompt_compiler.mjs`, `compileImagePrompt`, Visual Bible inputs, generation modes, and the final image backend prompt source order

### Requirement: Prompt flow UI labels
The extension SHALL label prompt optimization controls as refinement after compilation rather than as a replacement for local compilation.

#### Scenario: User opens text model settings
- **WHEN** the L2 settings panel displays prompt optimization controls
- **THEN** the UI SHALL communicate that optimization/refinement happens after local compilation

#### Scenario: User disables refinement
- **WHEN** LLM refinement is disabled
- **THEN** the extension SHALL still compile usable image prompts locally before image generation

### Requirement: Final prompt source priority
The extension SHALL preserve diagnostics or documentation describing which prompt text is finally sent to the image backend.

#### Scenario: No optional refinement runs
- **WHEN** local compilation completes and optional refinement is disabled
- **THEN** the final prompt sent to the image backend SHALL be the compiled prompt after any enabled safety rewrite

#### Scenario: Optional refinement runs
- **WHEN** optional refinement succeeds
- **THEN** the final prompt sent to the image backend SHALL use the refined prompt after any enabled safety rewrite

#### Scenario: Optional refinement fails
- **WHEN** optional refinement fails or returns empty text
- **THEN** the extension SHALL fall back to the compiled prompt and continue according to existing generation failure behavior
