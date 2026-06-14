# generation-mode-ui Specification

## Purpose
TBD - created by archiving change image-generation-modes. Update Purpose after archive.
## Requirements
### Requirement: L2 tab information architecture
The L2 floating panel SHALL be redesigned around a mixed workflow/resource architecture rather than the existing scattered tabs.

#### Scenario: User opens the L2 panel
- **WHEN** the user opens the L2 floating panel
- **THEN** the panel SHALL present the main tabs `生成工作台`, `设定库`, `提示词模板`, `模型后端`, and `图库历史` or equivalent Chinese labels

#### Scenario: Backend and text model settings are needed
- **WHEN** the user needs to configure image backend or text optimization backend
- **THEN** those controls SHALL be grouped under the `模型后端` area instead of split across unrelated pages

#### Scenario: Visual references are managed
- **WHEN** the user manages style, character, scene, or worldbook extraction sources
- **THEN** those controls SHALL be grouped under the `设定库` area with clear sub-sections

#### Scenario: Prompt templates are edited
- **WHEN** the user edits single, multi, comic, analysis, cleanup, summarize, or NSFW templates
- **THEN** those controls SHALL be available under the standalone `提示词模板` area

#### Scenario: Browser viewport changes while the L2 panel is open
- **WHEN** the user resizes the browser window or the device orientation changes while the L2 floating panel is open
- **THEN** the panel SHALL recompute its maximum width and height from the current viewport
- **AND** the panel SHALL keep its visible bounds inside the viewport without requiring the user to close and reopen it

#### Scenario: New character-card library is empty
- **WHEN** the active character card has no saved visual library
- **THEN** the `设定库` area SHALL show empty summaries or a concise "current character-card library is empty" status instead of showing a previous card's values
### Requirement: Dual-column generation workbench
The generation workbench SHALL use a left-configuration and right-result layout on sufficiently wide screens.

#### Scenario: User opens generation workbench on desktop
- **WHEN** the user opens `生成工作台` on a wide viewport
- **THEN** the left column SHALL contain mode selection, source text, mode parameters, character confirmation, and plan controls while the right column SHALL contain progress, preview, folded logs, and gallery shortcuts

#### Scenario: User opens generation workbench on narrow viewport
- **WHEN** the user opens `生成工作台` on a narrow viewport
- **THEN** the dual columns SHALL collapse into a usable vertical layout without forcing Chinese button text into vertical character layout

### Requirement: Generation workbench mode controls
The generation workbench SHALL configure single, multi, and comic modes from one primary workflow surface.

#### Scenario: User switches modes
- **WHEN** the user switches between single, multi, and comic modes
- **THEN** the UI SHALL show relevant controls for the selected mode and preserve user-entered source text

#### Scenario: User starts planning
- **WHEN** the user starts a plan from the workbench
- **THEN** the UI SHALL show the generated plan before or during execution according to the mode and confirmation settings

#### Scenario: User starts generation
- **WHEN** the user starts generation from the workbench
- **THEN** the UI SHALL show progress and preview output for the generated plan
- **AND** any detailed storyboard planning or prompt-template editing SHALL remain in folded logs, history, or the dedicated `提示词模板` area rather than as a persistent workbench section
### Requirement: Automatic flow controls
The generation workbench SHALL expose automatic whole-message generation controls while preserving manual generation controls.

#### Scenario: User enables automatic flow
- **WHEN** the user checks the automatic flow option
- **THEN** the UI SHALL show automatic mode configuration, minimum message length, queue status, and cancellation controls

#### Scenario: Automatic flow configuration follows workbench mode
- **WHEN** automatic flow is set to follow the saved workbench configuration
- **THEN** the UI SHALL make clear which mode, count, continuity, dialogue, and failure settings will be used for new AI messages

#### Scenario: Manual generation remains available
- **WHEN** automatic flow is enabled or disabled
- **THEN** the UI SHALL still provide a manual generate action for the current source text

#### Scenario: Automatic queue has items
- **WHEN** automatic jobs are queued or running
- **THEN** the right result column SHALL show queue entries and allow the user to cancel queued work where safe

### Requirement: Single mode controls
The UI SHALL expose single-image framing strategy controls.

#### Scenario: Single mode is selected
- **WHEN** the selected mode is single
- **THEN** the UI SHALL show framing strategy options for剧情高潮、总结海报、最后镜头 or equivalent Chinese labels

### Requirement: Multi mode controls
The UI SHALL expose user-selected image count and continuity controls for multi image mode.

#### Scenario: Multi mode is selected
- **WHEN** the selected mode is multi
- **THEN** the UI SHALL show image count selection, continuity strategy controls, and failure policy controls

#### Scenario: User chooses count
- **WHEN** the user selects a count
- **THEN** the displayed plan preview SHALL be able to show the same number of planned story beats after planning

### Requirement: Comic mode controls
The UI SHALL expose comic panel and dialogue controls.

#### Scenario: Comic mode is selected
- **WHEN** the selected mode is comic
- **THEN** the UI SHALL show panel generation style and dialogue handling controls

#### Scenario: Plugin bubble dialogue is selected
- **WHEN** the dialogue mode is plugin bubbles
- **THEN** the UI SHALL make clear that readable dialogue will be stored/rendered by the plugin rather than relied on in the image

#### Scenario: Model text dialogue is selected
- **WHEN** the dialogue mode is model text
- **THEN** the UI SHALL warn that generated Chinese text may be unstable while still preserving dialogue metadata

### Requirement: Character confirmation UI
The UI SHALL allow users to review key character candidates for multi and comic planning when confirmation is enabled.

#### Scenario: Planner finds character candidates
- **WHEN** character candidates are available before plan execution
- **THEN** the UI SHALL allow the user to inspect, select, deselect, or edit key character references when confirmation is enabled

#### Scenario: User confirms candidates
- **WHEN** the user confirms the character candidate list
- **THEN** the next ImagePlan SHALL use the confirmed character references instead of silently replacing them with automatic guesses

#### Scenario: User skips confirmation
- **WHEN** confirmation is disabled or the user starts generation without editing candidates
- **THEN** the extension SHALL use configured defaults and automatically selected references while logging a concise character-selection summary

#### Scenario: Automatic path skips confirmation
- **WHEN** automatic `<pic>` or whole-message processing runs without interactive confirmation
- **THEN** the extension SHALL use configured defaults and log a concise character-selection summary

#### Scenario: Missing persona candidate exists
- **WHEN** a visible user/protagonist such as `齐齐` lacks a fixed appearance but has story-derived or context-derived candidate text
- **THEN** the UI SHALL show it as an editable candidate that can be confirmed into the current chat profile

#### Scenario: Candidate source is displayed
- **WHEN** a candidate is shown
- **THEN** the UI SHALL indicate whether its source is `chat library`, `worldbook`, `story-derived`, `imported legacy`, or `missing`
### Requirement: Progress, preview, and folded log UI
The workbench result column SHALL show plan progress, previews, retry controls, and folded diagnostic logs.

#### Scenario: Multi-job plan is running
- **WHEN** a plan contains multiple jobs
- **THEN** the UI SHALL show each job title, index, status, and available actions such as retry when applicable

#### Scenario: Job succeeds
- **WHEN** a job succeeds
- **THEN** its preview SHALL appear without waiting for all jobs to complete

#### Scenario: Job fails
- **WHEN** a job fails
- **THEN** the UI SHALL show a concise error summary and actions allowed by the selected failure policy

#### Scenario: Retry action is used
- **WHEN** the user clicks retry for a failed preview job
- **THEN** the UI SHALL rerun only that job, update the card in place, and preserve other preview cards

#### Scenario: Logs are available
- **WHEN** planning, sanitization, or generation produces diagnostic information
- **THEN** the UI SHALL show concise status entries in a collapsible log area while detailed developer logs remain available in the browser console

#### Scenario: Compiled prompt is available
- **WHEN** a job has a compiled prompt or refinement/safety diagnostics
- **THEN** the UI SHALL make the prompt available in preview, progress, history, or logs without overwhelming the main preview

#### Scenario: Plugin bubble dialogue is previewed
- **WHEN** a comic job uses plugin bubble dialogue mode and contains dialogue metadata
- **THEN** the manual preview SHALL show visible overlay bubbles while preserving the policy that the image backend must not render text into the picture

#### Scenario: Gallery lightbox supports adjacent images
- **WHEN** the user opens a generated preview image or gallery thumbnail and the current group contains multiple images
- **THEN** the lightbox SHALL allow moving to the previous and next image by UI controls and keyboard arrows

#### Scenario: Policy retry is available
- **WHEN** a failed job has error class `policy` and safe retry remains available
- **THEN** the UI SHALL expose a `安全重试` action on that failed job card
### Requirement: Gallery history area
The UI SHALL provide a gallery/history area for generated images and generation records.

#### Scenario: User opens gallery history
- **WHEN** the user opens `图库历史`
- **THEN** the UI SHALL show saved gallery items and generation records where available, with refresh and clear actions that do not wrap vertically

#### Scenario: User opens generation records
- **WHEN** generation-history records exist
- **THEN** the UI SHALL show each record's source, mode, status, image count, failed job count, and concise timestamp

#### Scenario: User retries from history
- **WHEN** a failed or previous job has enough metadata to retry
- **THEN** the UI SHALL expose a retry action without requiring the user to re-enter the entire source text

#### Scenario: User clears history
- **WHEN** the user clears generation history
- **THEN** the extension SHALL remove only the lightweight history index and SHALL NOT delete image files from disk

### Requirement: Accessibility and responsive layout
The redesigned L2 UI SHALL remain keyboard-accessible and responsive.

#### Scenario: Keyboard user navigates mode controls
- **WHEN** the user navigates with keyboard
- **THEN** mode controls, buttons, tabs, and dialogs SHALL be focusable with visible focus states

#### Scenario: Narrow viewport is used
- **WHEN** the L2 panel is displayed on a narrow viewport
- **THEN** controls SHALL wrap into usable rows or columns without forcing Chinese button text into vertical character layout

### Requirement: Inline fallback synchronization
UI changes SHALL keep external HTML/CSS and inline fallback synchronized.

#### Scenario: Full settings HTML changes
- **WHEN** `settings_full.html` changes
- **THEN** `SETTINGS_FULL_HTML` in `index.js` SHALL be regenerated or updated to match

#### Scenario: Style changes are made
- **WHEN** external CSS changes affect the floating panel or redesigned L2 UI
- **THEN** the inline style fallback embedded in full settings HTML SHALL remain consistent where applicable

### Requirement: Automatic workflow status visibility
The workbench UI SHALL show concise automatic whole-message generation status updates in a visible bounded status or progress area.

#### Scenario: Automatic task is queued
- **WHEN** an eligible AI message is queued for automatic whole-message generation
- **THEN** the workbench SHALL display a queue or progress status indicating that the task is waiting

#### Scenario: Automatic task starts
- **WHEN** automatic whole-message generation starts for a message
- **THEN** the workbench SHALL display that automatic generation has started
- **AND** console diagnostics SHALL retain the task id or message context when available

#### Scenario: Automatic task is skipped
- **WHEN** automatic whole-message generation skips a message because the feature is disabled, the message is ineligible, the message is too short, already has generated media, or duplicate processing is in flight
- **THEN** the workbench SHALL display or record a concise skip reason

#### Scenario: Automatic task succeeds
- **WHEN** automatic whole-message generation attaches images to a message
- **THEN** the workbench SHALL display a success status with the generated or attached image count

#### Scenario: Automatic task fails
- **WHEN** automatic whole-message generation fails
- **THEN** the workbench SHALL display a concise failure status and preserve the detailed error in progress cards, history, or console diagnostics

### Requirement: Automatic extraction controls are visible
The settings UI SHALL expose automatic character extraction and automatic scene extraction controls near the role-card Visual Bible library controls.

#### Scenario: User opens the settings library panel
- **WHEN** the user opens the L2 library/settings panel
- **THEN** separate automatic character extraction and automatic scene extraction switches SHALL be visible
- **AND** their labels SHALL indicate that writes are scoped to the current character card

### Requirement: Built-in style preset controls are visible
The settings UI SHALL expose built-in style presets without requiring the user to manually paste preset text.

#### Scenario: User opens the style library controls
- **WHEN** the user views the style library area
- **THEN** the UI SHALL provide a visible built-in style preset catalog or import action
- **AND** the UI SHALL indicate that importing presets writes to the current character-card style library
### Requirement: Chat-scoped library UI
The L2 visual library controls SHALL display and edit the active chat's scoped visual library.

#### Scenario: User opens settings in chat A
- **WHEN** the user opens the visual library controls while chat A is active
- **THEN** the character library, scene library, active style, and active scene fields SHALL display chat A's scoped values or explicit fallback/import values

#### Scenario: User switches to chat B
- **WHEN** the active chat changes from chat A to chat B
- **THEN** the visual library controls SHALL refresh to chat B's scoped values and SHALL NOT keep chat A's visible field values

#### Scenario: User edits a library field
- **WHEN** the user edits character or scene library text in the L2 panel
- **THEN** the edit SHALL be saved to the active chat scope
### Requirement: Visual Bible diagnostics UI
The generation workbench SHALL expose concise diagnostics for the Visual Bible used by the current plan.

#### Scenario: Plan is created
- **WHEN** a single, multi, or comic plan is created
- **THEN** the workbench diagnostics SHALL show the selected chat scope, style, scene, matched characters, and missing fixed references

#### Scenario: Legacy fallback is used
- **WHEN** Visual Bible resolution uses legacy global data
- **THEN** the diagnostics SHALL mark the fallback source so the user can distinguish it from chat-scoped data
### Requirement: Dialogue generation controls
The comic workbench controls SHALL separate dialogue generation enablement from dialogue rendering mode.

#### Scenario: Comic mode is selected
- **WHEN** the selected generation mode is comic
- **THEN** the UI SHALL expose a dialogue generation toggle and a rendering mode selector for plugin bubbles versus model text

#### Scenario: Dialogue generation is disabled
- **WHEN** the dialogue generation toggle is off
- **THEN** the UI SHALL keep the rendering mode setting available but SHALL make clear that no dialogue will be required for the next plan

#### Scenario: Bubble mode has dialogue
- **WHEN** plugin bubble mode is selected and planned dialogue exists
- **THEN** the preview UI SHALL render plugin bubbles rather than relying on image-model text
