## ADDED Requirements

### Requirement: Release validation covers automatic visual extraction
Release validation SHALL verify optional automatic character and scene extraction in a real or simulated conversation flow.

#### Scenario: Automatic extraction writes to active card
- **WHEN** automatic character and scene extraction are enabled for an eligible AI message
- **THEN** extracted visual entries SHALL be written only to the active role-card Visual Bible scope

#### Scenario: Automatic extraction defaults are checked
- **WHEN** release validation opens settings for a fresh or migrated configuration
- **THEN** automatic character extraction and automatic scene extraction SHALL be confirmed default-off unless the user's saved settings explicitly enable them

#### Scenario: Duplicate extraction is checked
- **WHEN** release validation extracts a character or scene whose normalized name already exists
- **THEN** the existing manually edited entry SHALL remain unchanged
