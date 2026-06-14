# chat-visual-bible Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Current chat Visual Bible
The extension SHALL resolve a current-chat Visual Bible before compiling image prompts.

#### Scenario: Visual Bible is resolved
- **WHEN** any single, multi, comic, manual, automatic, message-button, or legacy tag generation path creates an image plan or image job
- **THEN** the extension SHALL resolve the active chat's Visual Bible containing style, character, scene, continuity, camera/composition, and negative constraints

#### Scenario: Chat-scoped references exist
- **WHEN** the active chat scope contains character and scene references
- **THEN** the Visual Bible SHALL prefer those chat-scoped references over legacy global library values

#### Scenario: Only legacy references exist
- **WHEN** the active chat has no scoped references but legacy global references are available
- **THEN** the Visual Bible MAY use them as fallback sources and SHALL record that source in diagnostics
### Requirement: Shared prompt compilation contract
The extension SHALL feed the same current-chat Visual Bible into single, multi, and comic prompt compilation.

#### Scenario: Single image prompt is compiled
- **WHEN** single image generation compiles a prompt
- **THEN** the prompt SHALL include relevant Visual Bible style, character, scene, and negative constraints

#### Scenario: Multi image prompts are compiled
- **WHEN** a multi image StoryBeat plan compiles multiple prompts
- **THEN** every prompt in the plan SHALL use the same Visual Bible for shared visual references while keeping each beat's specific action and framing

#### Scenario: Comic prompts are compiled
- **WHEN** a comic panel plan compiles panel prompts
- **THEN** every panel prompt SHALL use the same Visual Bible for shared visual references while keeping each panel's composition and dialogue policy
### Requirement: Visual Bible diagnostics
The extension SHALL expose concise diagnostics describing how the Visual Bible affected each plan and job.

#### Scenario: Prompt diagnostics are recorded
- **WHEN** an ImagePlan or ImageJob is created from a Visual Bible
- **THEN** diagnostics SHALL include the chat scope key, storage source, selected style, selected scene, matched character references, missing character references, and whether legacy fallback was used

#### Scenario: Generation history is written
- **WHEN** generation history records a completed or failed job
- **THEN** the record SHALL include concise Visual Bible diagnostics without storing unbounded source text or base64 image bytes

#### Scenario: Character reference is missing
- **WHEN** a visible story character has no fixed appearance reference
- **THEN** the character SHALL remain visible in the compiled prompt and diagnostics SHALL mark the missing fixed reference
