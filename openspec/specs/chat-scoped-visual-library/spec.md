# chat-scoped-visual-library Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Chat visual scope identity
The extension SHALL resolve a stable visual-library scope for the active chat before reading or writing character, scene, active style, active scene, or confirmed-character state.

#### Scenario: Chat metadata is writable
- **WHEN** SillyTavern exposes writable current-chat metadata
- **THEN** the extension SHALL store the visual-library scope in namespaced chat metadata for the active chat

#### Scenario: Chat metadata is unavailable
- **WHEN** writable chat metadata is not available
- **THEN** the extension SHALL store the visual-library scope in localStorage under a namespaced key that includes chat identity and character context rather than only the extension name

#### Scenario: Different chats share a character
- **WHEN** two chats use the same character card but have different chat identities
- **THEN** their visual-library scope keys SHALL be different
### Requirement: Isolated visual library state
The extension SHALL keep character library, scene library, active style, active scene, and confirmed-character state isolated per chat scope.

#### Scenario: Character library is edited in one chat
- **WHEN** the user edits the character library while chat A is active
- **THEN** the edit SHALL be saved only to chat A's visual scope

#### Scenario: Another chat is opened
- **WHEN** the user switches from chat A to chat B
- **THEN** chat B SHALL NOT inherit chat A's character library, scene library, active scene, active style, or confirmed-character state unless the user explicitly imports them

#### Scenario: Original chat is reopened
- **WHEN** the user returns from chat B to chat A
- **THEN** chat A's previously saved visual-library state SHALL be restored
### Requirement: Legacy global visual data compatibility
The extension SHALL preserve legacy global visual-library settings as fallback/import/default sources without writing new chat edits back to those global fields.

#### Scenario: Existing global character library exists
- **WHEN** the active chat has no scoped character library and a legacy global character library exists
- **THEN** the extension SHALL make the legacy data available as a fallback or import source without treating it as already written to the chat scope

#### Scenario: User edits after legacy fallback
- **WHEN** the user edits a library field after legacy fallback data was displayed or imported
- **THEN** the extension SHALL save the new value to the current chat scope and SHALL NOT mutate the legacy global field

#### Scenario: New chat has no scoped library
- **WHEN** a new chat without scoped visual data is opened
- **THEN** the extension SHALL start from an empty or explicitly imported library state rather than silently copying another chat's scoped data
### Requirement: Chat switch refresh
The extension SHALL refresh the visual-library UI and in-memory confirmation state when SillyTavern changes chats.

#### Scenario: Chat changed event fires
- **WHEN** the SillyTavern `CHAT_CHANGED` event fires
- **THEN** the extension SHALL reload the current chat visual scope and refresh the settings fields that display character library, scene library, active style, active scene, and confirmed characters

#### Scenario: Manual workbench state exists
- **WHEN** the user switches chats after confirming character candidates
- **THEN** the old chat's confirmed candidate state SHALL NOT remain active in the new chat
