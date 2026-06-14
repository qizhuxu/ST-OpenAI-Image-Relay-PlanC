## ADDED Requirements

### Requirement: Unified prompt preflight entry point
The extension SHALL run a Prompt Preflight Pipeline before any image backend request created by a supported generation entry path.

#### Scenario: Manual single generation runs preflight
- **WHEN** the user starts manual single-image generation from the workbench
- **THEN** the extension SHALL clean the source text, create a PromptDraft, compile the draft locally, run safety classification, validate the final prompt, and send only the validated final prompt to the backend

#### Scenario: Automatic whole-message generation runs preflight
- **WHEN** a new AI message is eligible for automatic whole-message generation
- **THEN** the automatic job SHALL run through the same Prompt Preflight Pipeline before requesting images

#### Scenario: Legacy pic tag generation runs preflight
- **WHEN** a legacy `<pic prompt="...">` tag is extracted from an assistant message
- **THEN** the extracted prompt SHALL be converted into a PromptDraft and validated by preflight before the backend request

#### Scenario: Message action generation runs preflight
- **WHEN** a user clicks a per-message generation or summarize-and-generate action
- **THEN** the source text or summarized visual target SHALL run through preflight before images are requested

#### Scenario: Multi and comic jobs run preflight
- **WHEN** a multi StoryBeat job or comic ComicPanel job is created
- **THEN** each ImageJob SHALL receive its own PromptDraft and final prompt through preflight before execution

### Requirement: Source cleanup before visual planning
The Prompt Preflight Pipeline SHALL remove low-visual and prompt-polluting source segments before selecting or compiling a visual moment.

#### Scenario: HTML and CSS source is present
- **WHEN** source text contains HTML markup, CSS blocks, style attributes, or rendered UI wrapper fragments
- **THEN** preflight SHALL remove those fragments from the cleaned source used for visual moment selection

#### Scenario: Hidden reasoning and mechanical game data are present
- **WHEN** source text contains hidden thinking blocks, `charThink` sections, numerical stat calculations, skill/equipment YAML-like data, or game-system bookkeeping
- **THEN** preflight SHALL exclude those segments from the visual moment while preserving concise diagnostics that cleanup occurred

#### Scenario: User choice list and safety boilerplate are present
- **WHEN** source text ends with numbered user choices, policy disclaimers, or generic safety/quality boilerplate
- **THEN** preflight SHALL keep the latest narrative visual scene and SHALL NOT let those boilerplate lines become prompt subjects

#### Scenario: Cleanup removes too much
- **WHEN** cleanup leaves no useful visual text
- **THEN** preflight SHALL fall back to the original source summary or extracted legacy prompt and record a cleanup fallback diagnostic

### Requirement: PromptDraft data contract
The preflight result SHALL expose a structured PromptDraft that separates source, visual intent, protected references, safety state, and final prompt state.

#### Scenario: Draft is created
- **WHEN** preflight processes an ImageJob or source prompt
- **THEN** the resulting draft SHALL include source text, cleaned text, mode, visual moment, visible characters, non-visual characters, protected character references, protected scene references, protected style, dialogue policy, compiled prompt, final prompt, risk report, validation result, and diagnostics where available

#### Scenario: Non-visual character is detected
- **WHEN** a character appears only as an inner voice, narrator, system spirit, memory, quoted instruction, or non-visible assistant in the source scene
- **THEN** the draft SHALL classify that character as non-visual by default and SHALL NOT inject its full appearance into the visible subject prompt unless the source explicitly depicts it as visible

#### Scenario: Visible character lacks fixed reference
- **WHEN** a visible named character has no protected character reference
- **THEN** the draft SHALL keep the character name in visible characters and SHALL record a missing-reference diagnostic instead of replacing the character with a generic person

### Requirement: Final prompt validation
The Prompt Preflight Pipeline SHALL validate the final prompt before image backend dispatch.

#### Scenario: Required protected character is lost
- **WHEN** refinement or safety rewriting removes a required visible character name or protected appearance anchor
- **THEN** validation SHALL fail that candidate and the final prompt SHALL fall back to the last valid compiled or safety-cleaned prompt

#### Scenario: Required scene reference is lost
- **WHEN** the selected scene reference is required for the job and the candidate final prompt drops its key scene anchors
- **THEN** validation SHALL fail that candidate and record a scene-preservation diagnostic

#### Scenario: Plugin bubble dialogue mode is active
- **WHEN** comic dialogue mode is plugin bubbles
- **THEN** validation SHALL ensure the backend prompt does not ask the image model to draw readable dialogue text, subtitles, or watermarks

#### Scenario: Final prompt is empty
- **WHEN** every candidate prompt is empty after cleanup, refinement, or safety processing
- **THEN** preflight SHALL synthesize a conservative local prompt from the source visual moment and available protected references rather than sending an empty prompt
