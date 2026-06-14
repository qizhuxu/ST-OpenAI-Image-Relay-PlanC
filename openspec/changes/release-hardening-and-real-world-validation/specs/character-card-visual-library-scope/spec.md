## ADDED Requirements

### Requirement: Release validation covers role-card isolation
Release validation SHALL prove that role-card visual libraries do not leak across character cards.

#### Scenario: Card A data does not leak to card B
- **WHEN** release validation writes or imports visual library data for card A
- **THEN** switching to card B SHALL show no inherited card A character or scene entries

#### Scenario: New card C starts empty
- **WHEN** release validation opens a new card C with no saved Visual Bible entries
- **THEN** card C character and scene libraries SHALL remain empty except for designed built-in style visibility or import UI

#### Scenario: Test mutations are restored
- **WHEN** release validation changes role-card visual scope data
- **THEN** the validation SHALL restore or document the changed localStorage/scope keys before completion
