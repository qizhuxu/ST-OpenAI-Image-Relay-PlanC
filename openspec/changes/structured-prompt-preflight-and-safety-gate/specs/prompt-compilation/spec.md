## ADDED Requirements

### Requirement: PromptDraft-backed compilation
The prompt compiler SHALL compile from structured preflight intent whenever PromptDraft fields are available.

#### Scenario: PromptDraft is available
- **WHEN** an ImageJob has a PromptDraft with visual moment, visible characters, protected references, scene, style, actions, anchors, and dialogue policy
- **THEN** the compiler SHALL use those structured fields rather than re-parsing uncleaned raw source text

#### Scenario: Non-visual character has a library entry
- **WHEN** a character has a fixed visual library entry but the PromptDraft classifies that character as non-visual for the current image
- **THEN** the compiled prompt SHALL NOT include that character as a visible subject or inject its full appearance into the visible subject section

#### Scenario: Protected references are included
- **WHEN** the PromptDraft marks character, scene, or style references as protected and relevant to the job
- **THEN** the compiled prompt SHALL preserve their names and key visual anchors in dedicated sections or equivalent structured text

### Requirement: Refinement cannot override protected compile intent
Optional LLM refinement SHALL be accepted only when it preserves protected compile intent.

#### Scenario: Refinement changes protected character
- **WHEN** the refinement output drops, renames, or contradicts a required visible character or protected appearance anchor
- **THEN** the extension SHALL reject the refinement and use the compiled prompt as the next candidate

#### Scenario: Refinement changes scene or dialogue policy
- **WHEN** the refinement output changes the selected scene, removes required scene anchors, or asks the image backend to draw text while plugin bubble mode is active
- **THEN** the extension SHALL reject the refinement and record the rejected reason in diagnostics

#### Scenario: Refinement improves only expression
- **WHEN** the refinement output preserves protected characters, scene, style, dialogue policy, and visual moment while improving composition, lighting, camera language, or repetition
- **THEN** the extension MAY accept the refined prompt as the next candidate before safety classification and validation

### Requirement: Backend prompt templates are direct wrappers
The final compiled/preflight prompt SHALL remain the primary content sent to image backends.

#### Scenario: Images API template is defaulted
- **WHEN** default settings are used for Images API generation
- **THEN** the Images API prompt template SHALL be `{{prompt}}` or equivalent direct substitution

#### Scenario: Chat Completions template is defaulted
- **WHEN** default settings are used for Chat Completions image generation
- **THEN** the Chat Completions prompt template SHALL be `{{prompt}}` or equivalent direct substitution unless a backend-specific compatibility preset intentionally changes it
