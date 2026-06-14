# comic-dialogue-generation Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Dialogue enablement
Comic generation SHALL have an explicit dialogue-enabled state that controls whether the planner must produce dialogue and caption metadata.

#### Scenario: Dialogue generation is enabled
- **WHEN** comic mode starts with dialogue generation enabled
- **THEN** the planner prompt SHALL require panel dialogue and caption metadata where story content supports it

#### Scenario: Dialogue generation is disabled
- **WHEN** comic mode starts with dialogue generation disabled
- **THEN** the planner prompt SHALL NOT require dialogue or caption metadata and the compiled image prompts SHALL NOT invent dialogue

#### Scenario: Dialogue setting is saved
- **WHEN** the user changes the dialogue-enabled state
- **THEN** the extension SHALL persist the setting and reuse it for manual, automatic, and legacy comic generation paths
### Requirement: Dialogue metadata continuity
Comic dialogue and captions SHALL be preserved as ImageJob metadata from planning through preview, history, retry, and attachment.

#### Scenario: Planner returns dialogue
- **WHEN** the comic planner returns panel dialogue or captions
- **THEN** each corresponding ImageJob SHALL store the dialogue, caption, dialogue-enabled state, and dialogue rendering mode

#### Scenario: Comic job is retried
- **WHEN** a failed comic ImageJob is retried
- **THEN** the retry SHALL preserve the original dialogue and caption metadata unless the user replans the comic

#### Scenario: History is shown
- **WHEN** comic generation history is rendered
- **THEN** the record SHALL retain enough dialogue metadata to diagnose whether bubble or model-text behavior was used
### Requirement: Bubble and model-text prompt policy
Comic prompt compilation SHALL handle dialogue according to the selected rendering mode.

#### Scenario: Bubble mode is selected
- **WHEN** dialogue is enabled and the rendering mode is plugin bubbles
- **THEN** the compiled image prompt SHALL forbid readable in-image text and SHALL preserve dialogue metadata for plugin rendering

#### Scenario: Model-text mode is selected
- **WHEN** dialogue is enabled and the rendering mode is model text
- **THEN** the compiled image prompt SHALL request readable dialogue or caption text in the image while preserving the same dialogue metadata

#### Scenario: Dialogue is disabled
- **WHEN** dialogue is disabled
- **THEN** the compiled image prompt SHALL omit dialogue text instructions regardless of the saved rendering mode
### Requirement: Plugin bubble rendering
The extension SHALL render plugin dialogue bubbles when bubble mode has dialogue metadata.

#### Scenario: Preview card has bubble metadata
- **WHEN** a comic preview card is rendered for a bubble-mode job with dialogue metadata
- **THEN** the preview SHALL display plugin-rendered dialogue bubbles or captions over the preview image

#### Scenario: Bubble metadata exists without image text
- **WHEN** bubble mode forbids model-rendered text in the image prompt
- **THEN** the preview SHALL still display the dialogue using plugin-rendered bubbles
