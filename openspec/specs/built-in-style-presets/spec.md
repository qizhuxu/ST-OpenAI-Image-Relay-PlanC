# built-in-style-presets Specification

## Purpose
Defines extension-owned style presets and how they are exposed or imported without overwriting role-card visual libraries.

## Requirements
### Requirement: Built-in style preset catalog
The extension SHALL provide an extension-owned catalog containing at least three built-in style presets with stable names and descriptive prompt text.

#### Scenario: Built-in presets are available
- **WHEN** the extension initializes
- **THEN** the built-in style preset catalog SHALL contain at least three named presets
- **AND** each preset SHALL include non-empty visual style text suitable for image prompt compilation

#### Scenario: Built-in presets are visible for an empty role-card style library
- **WHEN** the active character-card style library is empty
- **THEN** the settings UI SHALL expose the built-in style presets as available defaults or importable presets
- **AND** the active character-card character and scene libraries SHALL remain empty

### Requirement: Built-in style import does not overwrite role-card styles
The extension SHALL allow built-in style presets to be imported into the active character-card style library without overwriting existing user-authored style entries.

#### Scenario: Existing role-card style library is non-empty
- **WHEN** a character card already has saved style entries
- **THEN** `ensureSettings` and UI refresh SHALL NOT replace those entries with built-in presets

#### Scenario: User imports built-in styles
- **WHEN** the user imports built-in style presets into the active character card
- **THEN** missing built-in presets SHALL be appended to that card's `styleLibrary`
- **AND** existing style entries with the same normalized name SHALL keep their original user-authored text

#### Scenario: Another role card is active
- **WHEN** the user switches from card A to card B
- **THEN** card B SHALL NOT inherit style entries imported into card A unless the user imports them into card B
