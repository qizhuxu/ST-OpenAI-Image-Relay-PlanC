# prompt-compilation Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Unified prompt compiler
The extension SHALL compile planned image intent into image-backend-ready prompts before requesting images.

#### Scenario: Single job is compiled
- **WHEN** a single ImageJob is created from source text
- **THEN** the extension SHALL compile the selected single visual target into a prompt containing subject, visible characters, shot, composition, action, scene, lighting, visual anchors, and negative constraints

#### Scenario: Multi job is compiled
- **WHEN** a multi ImageJob is created from a StoryBeat
- **THEN** the extension SHALL compile only that beat's visible moment, characters, actions, scene, anchors, and shared references into the job prompt

#### Scenario: Comic job is compiled
- **WHEN** a comic ImageJob is created from a ComicPanel
- **THEN** the extension SHALL compile panel composition, shot type, visible characters, actions, anchors, dialogue policy, and caption metadata into the job prompt

#### Scenario: Prompt compiler does not call text model
- **WHEN** the compiler runs
- **THEN** it SHALL produce a prompt locally without making an LLM request
### Requirement: Job-scoped fixed references
The compiler SHALL scope fixed visual references to the image job being generated.

#### Scenario: Referenced character appears in job
- **WHEN** a planned job lists visible characters that have fixed visual descriptions
- **THEN** the compiled prompt SHALL include those character descriptions

#### Scenario: Unrelated character is absent from job
- **WHEN** a fixed character description exists but that character is not visible in the planned job
- **THEN** the compiled prompt SHALL omit that unrelated character unless the selected single poster strategy intentionally uses them

#### Scenario: Character lacks visual reference
- **WHEN** a visible named character has no usable fixed visual description
- **THEN** the compiled prompt SHALL keep the character name and add a concise diagnostic warning without blocking generation
### Requirement: Optional prompt refinement
Prompt optimization SHALL be treated as optional refinement of compiled prompts.

#### Scenario: Manual refinement is requested
- **WHEN** the user clicks the prompt optimization/refinement button
- **THEN** the extension SHALL run the configured text-model refinement on the compiled prompt or current prompt preview and show the refined result

#### Scenario: Automatic refinement is disabled
- **WHEN** `optimizeAuto` is disabled
- **THEN** the extension SHALL still generate a compiled prompt without calling the optimizer

#### Scenario: Automatic refinement is enabled
- **WHEN** `optimizeAuto` is enabled for an entry path that supports refinement
- **THEN** the extension SHALL refine the compiled prompt after planning and compilation, not use refinement as a replacement for planning
### Requirement: Graded prompt safety rewrite
The extension SHALL support graded safety rewriting for final image prompts.

#### Scenario: Standard safety rewrite processes action scene
- **WHEN** the standard safety level rewrites a prompt with non-graphic combat, weapons, fantasy props, pursuit, threat, or impact
- **THEN** it SHALL preserve the action choreography, cinematic tension, fantasy items, and non-graphic conflict while removing gore, explicit severe injury, dismemberment, sexual content, and nudity

#### Scenario: Strict safety rewrite is selected
- **WHEN** strict safety level is selected
- **THEN** the extension MAY soften violent threat more aggressively while still preserving the basic scene intent

#### Scenario: Loose safety rewrite is selected
- **WHEN** loose safety level is selected
- **THEN** the extension SHALL only remove explicit sexual content, nudity, gore, and severe injury details while preserving more dramatic wording

#### Scenario: Safety rewrite is disabled
- **WHEN** NSFW avoidance is disabled
- **THEN** the extension SHALL send the compiled or refined prompt without safety rewrite
### Requirement: Prompt diagnostics
The extension SHALL retain concise prompt diagnostics for preview, history, and retry.

#### Scenario: Job prompt is recorded
- **WHEN** an ImageJob is compiled
- **THEN** the job SHALL retain the compiled prompt used for generation and any concise diagnostics needed to explain strategy, selected references, refinement, and safety level

#### Scenario: Generation history is saved
- **WHEN** a generation record is written
- **THEN** the record SHALL avoid storing base64 image bytes or unbounded source text while retaining enough prompt metadata for retry and diagnosis
