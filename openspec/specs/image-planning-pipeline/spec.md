# image-planning-pipeline Specification

## Purpose
TBD - created by archiving change image-generation-modes. Update Purpose after archive.
## Requirements
### Requirement: ImagePlan data model
The extension SHALL represent generation intent as an ImagePlan before creating backend requests.

#### Scenario: Single image plan is created
- **WHEN** source text is processed in single image mode
- **THEN** the extension SHALL create an ImagePlan containing mode, source text, fixed visual references, selected strategy, and one or more planned jobs

#### Scenario: Multi image plan is created
- **WHEN** source text is processed in multi image mode
- **THEN** the extension SHALL create an ImagePlan containing the selected count, story beats, continuity settings, failure policy, and planned jobs

#### Scenario: Comic plan is created
- **WHEN** source text is processed in comic mode
- **THEN** the extension SHALL create an ImagePlan containing comic panels, dialogue metadata, layout intent, continuity settings, failure policy, and planned jobs

### Requirement: ImageJob execution model
The extension SHALL execute image generation through ImageJob objects rather than only raw prompt strings, and each job SHALL retain enough metadata for targeted retry and history display.

#### Scenario: Text-to-image job executes
- **WHEN** an ImageJob has kind `text2image`
- **THEN** the extension SHALL send the job prompt through the existing chat completions or images generations backend path and persist returned images

#### Scenario: Edit job is unsupported
- **WHEN** an ImageJob has kind `edit` but the configured backend edit capability is unavailable
- **THEN** the extension SHALL fall back according to the selected failure or downgrade policy without breaking the whole plan

#### Scenario: Job result is persisted
- **WHEN** an ImageJob succeeds
- **THEN** the extension SHALL record its persisted image URLs, prompt, source, index, mode, title, duration, and retry metadata for preview, attachment, history, and gallery usage

#### Scenario: Retryable job fails
- **WHEN** an ImageJob fails under a retry-capable policy
- **THEN** the extension SHALL preserve its prompt, title, mode, index, source text summary, error summary, and retryable flag

#### Scenario: Job is retried
- **WHEN** the user retries a failed ImageJob
- **THEN** the extension SHALL execute only that ImageJob, update its status/result/error fields, and keep other jobs in the same plan unchanged

#### Scenario: Policy-safe retry is used
- **WHEN** a policy-safe retry executes a rewritten prompt
- **THEN** the retry SHALL keep the original ImageJob identity, current-chat Visual Bible diagnostics, and source profile references
### Requirement: Story beat planning
Multi image mode SHALL convert source text into ordered StoryBeat objects.

#### Scenario: Story beats are planned
- **WHEN** multi image mode starts
- **THEN** the text planner SHALL return ordered beats containing title, visual moment, characters, scene, actions, and visual anchors

#### Scenario: Story beat prompt is built
- **WHEN** an ImageJob is created from a StoryBeat
- **THEN** the prompt SHALL include the beat-specific visual moment plus shared style, character, scene, and continuity references

### Requirement: Comic panel planning
Comic mode SHALL convert source text into ordered ComicPanel objects.

#### Scenario: Comic panels are planned
- **WHEN** comic mode starts
- **THEN** the text planner SHALL return panels containing panel index, shot type, image description, characters, actions, dialogue, caption, and visual anchors

#### Scenario: Comic panel prompt is built
- **WHEN** an ImageJob is created from a ComicPanel
- **THEN** the prompt SHALL include panel composition and character actions and SHALL handle dialogue according to the selected dialogue mode

### Requirement: Continuity strategy
The planning pipeline SHALL represent image continuity separately from prompt text.

#### Scenario: Continuity is disabled
- **WHEN** continuity mode is off
- **THEN** ImageJobs SHALL be generated without reference images while still using textual fixed references

#### Scenario: Previous-image continuity is selected
- **WHEN** continuity mode uses the previous image
- **THEN** each eligible job after the first SHALL reference the preceding successful job result when edit capability is available

#### Scenario: Base-and-previous continuity is selected
- **WHEN** continuity mode uses first image plus previous image
- **THEN** eligible jobs SHALL include both the first successful image and the previous successful image as continuity references when edit capability is available

### Requirement: Queue progress reporting
The pipeline SHALL expose per-job status for UI progress and SHALL keep completed or failed jobs diagnosable after a plan finishes.

#### Scenario: Job starts
- **WHEN** an ImageJob begins execution
- **THEN** its status SHALL become running and the UI SHALL be able to display the current index and title

#### Scenario: Job fails
- **WHEN** an ImageJob fails
- **THEN** its status SHALL include the error summary, retryable state, and the plan executor SHALL apply the selected failure policy

#### Scenario: Plan completes partially
- **WHEN** some jobs succeed and some fail
- **THEN** successful images SHALL remain previewable and attachable while failed jobs remain visible for retry or diagnosis

#### Scenario: Plan is recorded in history
- **WHEN** an ImagePlan finishes with any succeeded or failed jobs
- **THEN** the extension SHALL write a lightweight generation-history record without storing base64 image bytes

### Requirement: Role-card Visual Bible inputs include built-in style availability
The planning pipeline SHALL treat built-in styles as selectable/importable presets and role-card style entries as the authoritative persisted style library.

#### Scenario: Compiling with an imported built-in style
- **WHEN** a built-in style preset has been imported into the active role-card style library and selected as active style
- **THEN** ImagePlan and ImageJob prompt compilation SHALL use that style like any other role-card style entry

#### Scenario: Built-in style has not been imported
- **WHEN** the active role-card style library is empty and no built-in preset has been imported or selected
- **THEN** prompt compilation SHALL NOT silently persist built-in style text into the role-card scope

### Requirement: Prompt diagnostics distinguish compile, refinement, and safety
ImagePlan and ImageJob diagnostics SHALL distinguish local compilation, optional LLM refinement, and safety rewrite state.

#### Scenario: Job prompt is compiled
- **WHEN** an ImageJob prompt is compiled
- **THEN** diagnostics SHALL indicate that local compilation produced the base prompt
- **AND** diagnostics SHALL include relevant Visual Bible inputs such as role-card scope, style, character references, scene references, or missing references when available

#### Scenario: Job prompt is refined
- **WHEN** optional LLM refinement runs for an ImageJob prompt
- **THEN** diagnostics SHALL indicate refinement ran after compilation

#### Scenario: Job prompt is safety rewritten
- **WHEN** safety rewrite or policy-safe retry changes an ImageJob prompt
- **THEN** diagnostics SHALL indicate the safety rewrite or policy retry state

### Requirement: Auto-extracted library entries feed future compilation
Automatically extracted character and scene entries SHALL become normal role-card Visual Bible inputs for later prompt compilation.

#### Scenario: Character entry is auto-extracted
- **WHEN** a character entry is automatically extracted into the active role-card character library
- **THEN** later ImageJob compilation for that same role card SHALL be able to include the character description when the character is visible

#### Scenario: Scene entry is auto-extracted
- **WHEN** a scene entry is automatically extracted into the active role-card scene library
- **THEN** later ImageJob compilation for that same role card SHALL be able to include the scene description when the scene is selected or matched

#### Scenario: Another role card compiles a prompt
- **WHEN** another role card compiles a prompt
- **THEN** it SHALL NOT use auto-extracted character or scene entries from the first role card
### Requirement: ImagePlan Visual Bible binding
The planning pipeline SHALL attach the current chat Visual Bible to every ImagePlan before jobs are executed.

#### Scenario: Single ImagePlan is created
- **WHEN** source text is processed in single image mode
- **THEN** the ImagePlan SHALL include the current chat Visual Bible and prompt diagnostics

#### Scenario: Multi ImagePlan is created
- **WHEN** source text is processed in multi image mode
- **THEN** the ImagePlan SHALL include one shared Visual Bible used by every StoryBeat job

#### Scenario: Comic ImagePlan is created
- **WHEN** source text is processed in comic mode
- **THEN** the ImagePlan SHALL include one shared Visual Bible and the selected dialogue-enabled state
### Requirement: ImageJob prompt diagnostics
Each ImageJob SHALL retain the Visual Bible and dialogue information needed for retry, preview, and history.

#### Scenario: Job prompt is compiled
- **WHEN** an ImageJob prompt is compiled
- **THEN** the job SHALL store compiled prompt diagnostics including selected visual references and missing fixed references

#### Scenario: Job is retried
- **WHEN** a failed ImageJob is retried
- **THEN** the retry SHALL reuse the same Visual Bible diagnostics unless the plan is regenerated

#### Scenario: Job succeeds
- **WHEN** an ImageJob succeeds
- **THEN** generation history SHALL record its Visual Bible and dialogue diagnostics with the persisted image URLs
### Requirement: Missing fixed appearances stay visible
The planning pipeline SHALL keep visible story characters in jobs even when fixed appearance library entries are missing.

#### Scenario: Visible character lacks a library entry
- **WHEN** a story beat or comic panel contains a visible character without a fixed appearance reference
- **THEN** the ImageJob prompt SHALL still include that character as a visible subject and SHALL mark the missing reference in diagnostics

#### Scenario: User later confirms the character
- **WHEN** the user adds or confirms a fixed appearance for that character in the active chat scope
- **THEN** subsequent plans SHALL use the fixed reference from the current chat Visual Bible

#### Scenario: Visible persona lacks a library entry
- **WHEN** a user/protagonist appears in a source text without a fixed current-chat appearance
- **THEN** the ImageJob SHALL keep that name as a visible subject and attach an editable candidate when any usable context-derived description exists

#### Scenario: User confirms the character
- **WHEN** the user adds or confirms a fixed appearance for that character in the active chat profile
- **THEN** subsequent plans SHALL use the fixed reference from the current chat Visual Bible
