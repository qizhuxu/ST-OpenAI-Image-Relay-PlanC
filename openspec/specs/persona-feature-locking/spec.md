# persona-feature-locking Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: User and protagonist visual candidates
The extension SHALL identify user/protagonist names as first-class visual candidates when they are relevant to the current source text.

#### Scenario: User name appears without fixed appearance
- **WHEN** the active chat user or protagonist name appears in source text and has no fixed appearance in the current chat profile
- **THEN** the extension SHALL create a story-derived persona candidate rather than only marking the name as missing

#### Scenario: Persona source exists outside source text
- **WHEN** SillyTavern context, chat metadata, role-card data, worldbook data, or user-edited candidate text provides persona visual details
- **THEN** the extension SHALL prefer those details over a generic missing placeholder

#### Scenario: Persona candidate cannot be described
- **WHEN** no usable visual details can be extracted for a user/protagonist
- **THEN** diagnostics SHALL mark the candidate as `missing` and keep the visible name in the prompt without replacing it with an anonymous role
### Requirement: Persona confirmation persists to current chat profile
The extension SHALL let users confirm or edit persona candidates and save the result into the active chat visual profile.

#### Scenario: User confirms persona candidate
- **WHEN** the user confirms a persona candidate such as `齐齐`
- **THEN** the extension SHALL write the edited visual description to the current chat's character library
- **AND** subsequent generations in that chat SHALL use the saved profile entry as `chat library`

#### Scenario: User switches chats after confirmation
- **WHEN** a persona candidate is confirmed in chat A and the user switches to chat B
- **THEN** chat B SHALL NOT inherit that persona entry unless the user explicitly imports or confirms it there
### Requirement: Persona Visual Bible injection
The Visual Bible SHALL include confirmed persona references in all generation modes.

#### Scenario: Single image prompt is compiled
- **WHEN** a confirmed user/protagonist appears in single image source text
- **THEN** the compiled prompt SHALL include the confirmed appearance from the current chat profile

#### Scenario: Multi or comic prompt is compiled
- **WHEN** a confirmed user/protagonist appears in a StoryBeat or ComicPanel
- **THEN** every affected job prompt SHALL use the same confirmed persona reference

#### Scenario: Policy retry is used
- **WHEN** a policy-safe retry rewrites a failed prompt
- **THEN** it SHALL preserve safe persona identity and appearance constraints from the same Visual Bible
