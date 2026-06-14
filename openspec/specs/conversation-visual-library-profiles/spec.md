# conversation-visual-library-profiles Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Current chat visual profile ownership
The extension SHALL treat the active chat as owning its own visual library profile, including character library, scene library, active style, active scene, confirmed characters, and source diagnostics.

#### Scenario: New chat has no profile
- **WHEN** a chat with no saved visual profile is opened
- **THEN** the extension SHALL start with an empty current-chat profile or clearly marked fallback/import sources
- **AND** it SHALL NOT silently copy another chat's character or scene library

#### Scenario: Current chat profile is edited
- **WHEN** the user edits character library, scene library, active style, active scene, or confirmed characters
- **THEN** the extension SHALL save the edit only to the active chat visual profile

#### Scenario: User returns to a chat
- **WHEN** the user switches away from chat A and later returns to chat A
- **THEN** chat A's visual profile SHALL be restored, including confirmed characters and active scene/style
### Requirement: Explicit import and fallback sources
The extension SHALL distinguish owned chat profile data from imported or fallback data.

#### Scenario: Legacy data exists
- **WHEN** legacy global character or scene data exists and the current chat profile is empty
- **THEN** the extension MAY expose it as fallback or explicit import source
- **AND** diagnostics SHALL NOT present it as owned current-chat data until imported or edited into the profile

#### Scenario: User imports a source
- **WHEN** the user imports legacy, worldbook, role-card, or story-derived references
- **THEN** imported values SHALL be written to the current chat profile with source diagnostics

#### Scenario: Fallback data is visible
- **WHEN** fallback data affects a Visual Bible
- **THEN** diagnostics SHALL mark the source as `imported legacy`, `worldbook`, or another non-chat-library source rather than plain `chat library`
### Requirement: Profile diagnostics source vocabulary
The extension SHALL use consistent source labels for visual references and diagnostics.

#### Scenario: Visual Bible diagnostics are shown
- **WHEN** an ImagePlan or ImageJob is created
- **THEN** diagnostics SHALL distinguish `chat library`, `imported legacy`, `worldbook`, `story-derived`, and `missing`

#### Scenario: Profile source is unknown
- **WHEN** a visual reference cannot be attributed to a known source
- **THEN** diagnostics SHALL use a concise fallback label and SHALL NOT omit the reference from the prompt solely because the label is unknown
