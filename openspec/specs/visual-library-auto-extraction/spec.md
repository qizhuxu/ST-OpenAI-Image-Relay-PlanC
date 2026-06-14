# visual-library-auto-extraction Specification

## Purpose
Defines optional, role-card-scoped automatic extraction of visual character and scene library entries from conversation content.

## Requirements
### Requirement: Optional automatic visual-library extraction switches
The extension SHALL provide separate default-off settings for automatic character-library extraction and automatic scene-library extraction.

#### Scenario: New settings default off
- **WHEN** settings are initialized or migrated
- **THEN** automatic character extraction SHALL be disabled by default
- **AND** automatic scene extraction SHALL be disabled by default

#### Scenario: User toggles automatic extraction
- **WHEN** the user changes the automatic character or scene extraction switch
- **THEN** the extension SHALL persist the selected value in extension settings
- **AND** the switch SHALL retain the saved value when the L2 panel is reopened

### Requirement: Character-card-scoped automatic extraction writes
The extension SHALL write automatically extracted character and scene entries only to the active character-card Visual Bible scope.

#### Scenario: Card A receives extracted entries
- **WHEN** card A is active and automatic extraction is enabled for an eligible AI message
- **THEN** extracted character or scene entries SHALL be saved under card A's visual scope

#### Scenario: User switches to card B
- **WHEN** card B is active after card A received extracted entries
- **THEN** card B SHALL NOT display or use card A's extracted character or scene entries

#### Scenario: New card C is opened
- **WHEN** a new card C has no saved Visual Bible entries
- **THEN** card C's character and scene libraries SHALL remain empty until the user edits them or automatic extraction writes to card C

### Requirement: Automatic extraction is conservative and deduped
The extension SHALL clean, sanitize, and dedupe extracted character and scene entries before saving them.

#### Scenario: Duplicate extracted character name
- **WHEN** automatic extraction finds a character entry whose normalized name already exists in the active card character library
- **THEN** the extension SHALL NOT overwrite the existing character description
- **AND** the duplicate candidate SHALL be ignored or reported as skipped

#### Scenario: Duplicate extracted scene name
- **WHEN** automatic extraction finds a scene entry whose normalized name already exists in the active card scene library
- **THEN** the extension SHALL NOT overwrite the existing scene description
- **AND** the duplicate candidate SHALL be ignored or reported as skipped

#### Scenario: Low-value extracted text
- **WHEN** automatic extraction finds system instructions, workflow text, HTML/code, or non-visual filler
- **THEN** the extension SHALL NOT save that text into the character or scene library

### Requirement: Manual library editing remains authoritative
The extension SHALL preserve existing manual library editing, clearing, active style, and active scene behavior when automatic extraction is enabled.

#### Scenario: User edits an extracted entry
- **WHEN** the user manually edits a character or scene entry that was previously extracted
- **THEN** future automatic extraction SHALL NOT replace that edited text by name

#### Scenario: User clears a library
- **WHEN** the user clears the active card character or scene library
- **THEN** that library SHALL remain empty until the user manually adds entries or a later enabled automatic extraction writes new non-duplicate entries for that same active card
