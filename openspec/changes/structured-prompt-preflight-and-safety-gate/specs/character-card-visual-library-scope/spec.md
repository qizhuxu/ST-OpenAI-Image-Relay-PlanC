## ADDED Requirements

### Requirement: Preflight uses active character-card visual scope
Prompt Preflight SHALL read visual libraries only from the active character-card/current visual scope resolved for the current chat context.

#### Scenario: Card A has libraries
- **WHEN** character card A is active and preflight resolves protected style, character, or scene references
- **THEN** the draft SHALL use card A's active visual scope values and SHALL record that scope in diagnostics

#### Scenario: User switches to card B
- **WHEN** the active character card changes from A to B before a new generation request
- **THEN** preflight SHALL resolve card B's visual scope and SHALL NOT use card A's character, scene, style, active style, active scene, or confirmed-character state

#### Scenario: New card has empty libraries
- **WHEN** a new character card with no saved visual library is active
- **THEN** preflight SHALL report missing or empty protected references and SHALL NOT inject stale values from another card or legacy global settings

### Requirement: Explicitly cleared libraries stay empty in preflight
Prompt Preflight SHALL respect explicit library clearing.

#### Scenario: Character library was cleared
- **WHEN** the active card's character library was explicitly cleared
- **THEN** preflight SHALL treat that library as empty and SHALL NOT refill it from legacy global, previous chat, or another character-card data

#### Scenario: Scene library was cleared
- **WHEN** the active card's scene library was explicitly cleared
- **THEN** preflight SHALL treat scene references as empty unless the user adds or imports new scene data into the active card scope
