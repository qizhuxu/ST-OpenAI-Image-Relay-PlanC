# character-card-visual-library-scope Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Character-card visual scope identity
The extension SHALL resolve a stable character-card visual-library scope before reading or writing style, character, scene, active style, active scene, or confirmed-character state.

#### Scenario: Character card has an avatar identifier
- **WHEN** SillyTavern exposes a character avatar or avatar file for the active role card
- **THEN** the extension SHALL use that avatar identity in the visual scope key
- **AND** the key SHALL NOT include the active chat id as the primary owner

#### Scenario: Character card has no avatar identifier
- **WHEN** the active role card lacks an avatar identifier but exposes a character id or character name
- **THEN** the extension SHALL use the best available character id or name in the visual scope key

#### Scenario: No character card identity is available
- **WHEN** no stable role-card identity is available
- **THEN** the extension SHALL use a deterministic namespaced unknown-character key and SHALL keep it distinct from legacy global settings
### Requirement: Character-card-owned library isolation
The extension SHALL keep character library, scene library, style library, active style, active scene, and confirmed-character state isolated per character card.

#### Scenario: Card A has a saved library
- **WHEN** character card A is active and its visual library has saved values
- **THEN** the settings UI and prompt compiler SHALL use card A's saved values

#### Scenario: User switches from card A to card B
- **WHEN** the active character card changes from A to B
- **THEN** card B SHALL NOT display or use card A's character library, scene library, style library, active style, active scene, or confirmed characters

#### Scenario: Card B has a saved library
- **WHEN** character card B has its own saved visual library
- **THEN** the settings UI and prompt compiler SHALL display and use card B's saved values
- **AND** card A's values SHALL remain unchanged

#### Scenario: New card C has no library
- **WHEN** a new character card C with no saved visual library is opened
- **THEN** the settings UI SHALL show empty character, scene, and style libraries
- **AND** the prompt compiler SHALL report empty or missing card-library sources rather than using A, B, or legacy values
### Requirement: Explicit clear remains empty
The extension SHALL preserve explicit clearing of a character card's visual library across refreshes and card switches.

#### Scenario: User clears card A character library
- **WHEN** card A is active and the user clears the character library
- **THEN** card A's character library SHALL be saved as empty
- **AND** card A's confirmed-character state SHALL be saved as an empty array

#### Scenario: User clears card A scene library
- **WHEN** card A is active and the user clears the scene library
- **THEN** card A's scene library SHALL be saved as empty
- **AND** card A's active scene SHALL be saved as empty

#### Scenario: User returns to cleared card A
- **WHEN** the user switches away from card A and later returns to card A
- **THEN** the cleared libraries SHALL remain empty
- **AND** the extension SHALL NOT refill them from legacy global data, previous chat scopes, card B, or card C
### Requirement: Legacy data is explicit import only
The extension SHALL NOT automatically display or inject legacy global or chat-scoped visual data as the active character-card library.

#### Scenario: Legacy global data exists
- **WHEN** legacy global character, scene, style, active style, active scene, or confirmed-character data exists and the active character-card scope is empty
- **THEN** the active card library SHALL remain empty
- **AND** the legacy data SHALL NOT be marked as `chat library` or `character-card library`

#### Scenario: Old chat scope data exists
- **WHEN** old chat-scoped visual data exists for the current chat but the active character-card scope is empty
- **THEN** the active card library SHALL remain empty until the user explicitly imports or edits data into the card scope
### Requirement: Character-card switch refresh
The extension SHALL refresh visible library UI and in-memory Visual Bible state when the active chat or character card changes.

#### Scenario: Chat changed event fires
- **WHEN** SillyTavern emits `CHAT_CHANGED`
- **THEN** the extension SHALL reload the active character-card visual scope
- **AND** the settings UI SHALL clear stale DOM values before rendering the new card scope

#### Scenario: Floating panel opens after card switch
- **WHEN** the user opens the floating panel after switching character cards
- **THEN** the library summaries and hidden fields SHALL reflect the active character card rather than the previously opened card

#### Scenario: Floating panel remains open while card switches
- **WHEN** the L2 floating panel is already open and the active character card changes
- **THEN** the extension SHALL detect that the active character-card visual scope changed
- **AND** the visible library status, summaries, hidden fields, and in-memory workbench character state SHALL refresh to the active character card
- **AND** the panel SHALL NOT keep displaying the previously active card's character or scene library
