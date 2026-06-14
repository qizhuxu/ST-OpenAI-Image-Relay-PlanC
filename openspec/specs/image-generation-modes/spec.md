# image-generation-modes Specification

## Purpose
TBD - created by archiving change image-generation-modes. Update Purpose after archive.
## Requirements
### Requirement: Generation modes
The extension SHALL support three generation modes: single image, multi image, and comic.

#### Scenario: User selects single image mode
- **WHEN** the user selects single image mode in the generation UI
- **THEN** the extension SHALL generate one image task from the source text using the selected single-image framing strategy

#### Scenario: User selects multi image mode
- **WHEN** the user selects multi image mode and chooses a count
- **THEN** the extension SHALL plan that number of story beats and generate one image task per beat

#### Scenario: User selects comic mode
- **WHEN** the user selects comic mode
- **THEN** the extension SHALL plan comic panels with image descriptions and dialogue metadata before generating panel images

### Requirement: Single image framing strategy
Single image mode SHALL allow the user to choose how long剧情 is condensed into one visual prompt.

#### Scenario: User chooses climax framing
- **WHEN** the single-image strategy is set to剧情高潮
- **THEN** the generated plan SHALL focus on the most visually and narratively impactful moment

#### Scenario: User chooses poster framing
- **WHEN** the single-image strategy is set to总结海报
- **THEN** the generated plan SHALL combine main characters, setting, atmosphere, and visual anchors into a representative image without requiring a single exact moment

#### Scenario: User chooses final-shot framing
- **WHEN** the single-image strategy is set to最后镜头
- **THEN** the generated plan SHALL prioritize the final current scene in the source text over earlier events

### Requirement: Multi image count control
Multi image mode SHALL use a user-selected image count rather than silently choosing an unbounded number of images.

#### Scenario: User chooses a multi image count
- **WHEN** the user chooses 2, 3, 4, 5, or 6 images
- **THEN** the extension SHALL request a story plan containing that number of story beats

#### Scenario: Planner returns too many beats
- **WHEN** the text planner returns more beats than the selected count
- **THEN** the extension SHALL keep only the selected count and log a concise truncation message

#### Scenario: Planner returns too few beats
- **WHEN** the text planner returns fewer beats than the selected count
- **THEN** the extension SHALL preserve returned beats and create visible retryable missing-beat jobs for the remaining count

#### Scenario: Missing beat is retried
- **WHEN** the user retries a missing-beat job
- **THEN** the extension SHALL create or recover a prompt for that specific missing beat and run only that job without rerunning successful jobs

### Requirement: Comic dialogue modes
Comic mode SHALL support both plugin-rendered dialogue bubbles and model-rendered text, with plugin-rendered bubbles as the default.

#### Scenario: Plugin dialogue bubbles are selected
- **WHEN** the comic dialogue mode is plugin bubbles
- **THEN** image prompts SHALL avoid requiring readable in-image Chinese text and SHALL store dialogue metadata for plugin rendering

#### Scenario: Model-rendered text is selected
- **WHEN** the comic dialogue mode is model text
- **THEN** image prompts MAY include dialogue placement instructions for the image backend while still preserving dialogue metadata

### Requirement: Legacy pic tag compatibility
Existing `<pic prompt="...">` tags SHALL continue to work when the automatic whole-message flow is disabled, and explicit mode attributes SHALL be honored when present.

#### Scenario: Old pic tag is received without automatic whole-message flow
- **WHEN** the extension receives a `<pic prompt="...">` tag without a mode attribute and automatic whole-message flow is disabled
- **THEN** the extension SHALL process it as single image mode and preserve existing attach, save, and gallery behavior

#### Scenario: Single mode pic tag is received
- **WHEN** the extension receives a pic tag with `mode="single"` and automatic whole-message flow is disabled
- **THEN** the extension SHALL process the prompt as single image mode using the tag strategy when provided or the saved single-image strategy otherwise

#### Scenario: Multi mode pic tag is received
- **WHEN** the extension receives a pic tag with `mode="multi"` and automatic whole-message flow is disabled
- **THEN** the extension SHALL use the tag count when valid, plan that number of StoryBeat jobs, and attach successful generated images back to the message

#### Scenario: Comic mode pic tag is received
- **WHEN** the extension receives a pic tag with `mode="comic"` and automatic whole-message flow is disabled
- **THEN** the extension SHALL use tag panel/dialogue settings when valid, plan ComicPanel jobs, and attach successful generated images back to the message

#### Scenario: Unsupported pic tag attributes are received
- **WHEN** the extension receives a pic tag with unsupported or invalid mode/count/dialogue/failure attributes
- **THEN** the extension SHALL fall back to safe defaults, process as single image mode when mode is unsupported, and log a concise Chinese warning

#### Scenario: Automatic whole-message flow is enabled
- **WHEN** a new AI message contains a `<pic>` tag and automatic whole-message flow is enabled
- **THEN** the extension SHALL ignore the tag as a trigger and instead generate from the cleaned whole AI message using the saved automatic-flow mode configuration

### Requirement: Automatic whole-message generation
The extension SHALL support an opt-in automatic flow that generates images for every eligible new AI message while preserving manual generation.

#### Scenario: Automatic flow is enabled
- **WHEN** a new AI message is received and automatic flow is enabled
- **THEN** the extension SHALL clean the whole message text, plan generation using the saved automatic mode configuration, generate images, and attach successful images back to that message

#### Scenario: Automatic flow is disabled
- **WHEN** a new AI message is received and automatic flow is disabled
- **THEN** the extension SHALL not generate from the whole message unless a legacy `<pic>` trigger or manual action requests generation

#### Scenario: User message is received
- **WHEN** a user or system message is received
- **THEN** the automatic whole-message flow SHALL skip it

#### Scenario: Message is below minimum length
- **WHEN** a new AI message is shorter than the configured minimum length
- **THEN** the automatic whole-message flow SHALL skip generation and record a concise status reason

#### Scenario: Multiple AI messages arrive quickly
- **WHEN** multiple eligible AI messages arrive while automatic flow is enabled
- **THEN** the extension SHALL queue automatic jobs serially per chat to avoid overlapping generation requests

#### Scenario: User cancels queued automatic work
- **WHEN** the user cancels an automatic task from the UI
- **THEN** queued work SHALL be removed or running work SHALL be marked cancel-requested when safe, without deleting already attached images

#### Scenario: Automatic path finds missing persona
- **WHEN** automatic flow sees a user/protagonist with no fixed appearance
- **THEN** it SHALL preserve the name in the prompt and record a candidate or missing diagnostic without blocking generation
### Requirement: Manual generation preserved
The extension SHALL keep manual generation available regardless of automatic flow settings.

#### Scenario: User opens manual workbench
- **WHEN** the user enters source text and clicks manual generate
- **THEN** the extension SHALL generate using the workbench settings even if automatic flow is disabled

#### Scenario: Automatic flow is running
- **WHEN** automatic tasks are queued or running
- **THEN** the user SHALL still be able to start manual generation, subject to visible queue/progress constraints

### Requirement: Configurable failure policy
Multi image and comic generation SHALL expose a user-configurable failure policy, including a retry policy that preserves failed jobs for targeted retry.

#### Scenario: Continue policy is selected
- **WHEN** one image job fails during a multi-job plan
- **THEN** the extension SHALL mark that job failed and continue eligible remaining jobs

#### Scenario: Stop policy is selected
- **WHEN** one image job fails during a multi-job plan
- **THEN** the extension SHALL stop pending jobs and show the failed job state

#### Scenario: Retry policy is selected
- **WHEN** one image job fails and retry is available
- **THEN** the extension SHALL mark the job retryable, keep successful jobs intact, and allow retrying that job without rerunning the entire plan

#### Scenario: Retry policy is saved
- **WHEN** the user selects retry in multi, comic, or automatic failure settings
- **THEN** the extension SHALL persist the retry setting instead of normalizing it to continue or stop

#### Scenario: Policy retry is selected or available
- **WHEN** one image job fails with error class `policy`
- **THEN** the extension SHALL make a policy-safe retry available regardless of whether the normal failure policy is stop, continue, or retry
- **AND** the retry SHALL still be capped to prevent loops
### Requirement: Automatic whole-message generation reports lifecycle state
Automatic whole-message generation SHALL update task state and UI-visible status throughout its lifecycle.

#### Scenario: Automatic generation begins
- **WHEN** automatic whole-message generation accepts an eligible AI message
- **THEN** the task SHALL move through queued or running state
- **AND** the workbench SHALL be able to show the state without requiring browser console inspection

#### Scenario: Automatic generation is skipped
- **WHEN** automatic whole-message generation skips a message
- **THEN** the task or status surface SHALL retain a concise skip reason

#### Scenario: Automatic generation uses safety rewrite
- **WHEN** safety rewrite or policy-safe retry changes a prompt during automatic generation
- **THEN** the task diagnostics or status surface SHALL record that safety rewriting or policy retry occurred

#### Scenario: Automatic generation completes
- **WHEN** automatic whole-message generation succeeds, partially succeeds, fails, or is cancelled
- **THEN** the final task status SHALL be reflected in queue/progress/history state

### Requirement: Automatic extraction trigger timing
Automatic visual-library extraction SHALL run only for eligible conversation content and SHALL NOT block manual generation.

#### Scenario: New AI message arrives with extraction enabled
- **WHEN** a new eligible AI message is received and automatic character or scene extraction is enabled
- **THEN** the extension SHALL attempt extraction for the enabled library kinds before or alongside generation planning

#### Scenario: Extraction is disabled
- **WHEN** automatic character and scene extraction are both disabled
- **THEN** no automatic extraction write SHALL occur for the new AI message

#### Scenario: Manual generation is used
- **WHEN** the user runs manual generation
- **THEN** manual generation SHALL remain available regardless of automatic extraction settings
### Requirement: Generation modes use chat Visual Bible
All generation modes SHALL use the active chat Visual Bible before sending prompts to the image backend.

#### Scenario: Manual single generation starts
- **WHEN** the user starts manual single-image generation
- **THEN** the generated backend prompt SHALL include the active chat Visual Bible

#### Scenario: Multi generation starts
- **WHEN** the user starts multi-image generation
- **THEN** every StoryBeat prompt SHALL include the same active chat Visual Bible

#### Scenario: Comic generation starts
- **WHEN** the user starts comic generation
- **THEN** every panel prompt SHALL include the same active chat Visual Bible and the selected dialogue policy

#### Scenario: Automatic whole-message generation starts
- **WHEN** automatic whole-message generation processes a new AI message
- **THEN** the generation path SHALL use the active chat Visual Bible for the message's chat

#### Scenario: Policy retry starts
- **WHEN** a single, multi, comic, automatic, or legacy tag job is retried after a policy failure
- **THEN** the safe retry prompt SHALL preserve the same active chat Visual Bible where policy-safe
### Requirement: Legacy tag compatibility with chat scope
Legacy `<pic>` tag generation SHALL remain compatible while using chat-scoped visual references.

#### Scenario: Legacy pic tag is processed
- **WHEN** an old `<pic prompt="...">` tag is processed
- **THEN** the prompt SHALL be compiled with the active chat Visual Bible while preserving existing attachment, persistence, and gallery behavior

#### Scenario: Comic tag sets dialogue mode
- **WHEN** a `<pic mode="comic">` tag includes a valid dialogue mode attribute
- **THEN** the comic generation path SHALL use that dialogue mode for prompt policy while preserving dialogue metadata
### Requirement: Dialogue enablement across entry paths
Comic dialogue enablement SHALL apply consistently to manual, automatic, and legacy comic generation.

#### Scenario: Manual comic generation is enabled
- **WHEN** the user starts manual comic generation with dialogue enabled
- **THEN** the planner SHALL request dialogue metadata and the compiled prompts SHALL honor the selected rendering mode

#### Scenario: Automatic comic generation is enabled
- **WHEN** automatic whole-message generation runs in comic mode with dialogue enabled
- **THEN** the planner SHALL request dialogue metadata and the attached result SHALL preserve dialogue diagnostics

#### Scenario: Legacy comic tag runs with dialogue disabled
- **WHEN** a legacy comic tag or saved setting disables dialogue
- **THEN** the planner SHALL NOT require dialogue metadata and prompts SHALL NOT invent dialogue
