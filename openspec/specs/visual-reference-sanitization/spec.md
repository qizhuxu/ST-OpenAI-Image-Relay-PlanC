# visual-reference-sanitization Specification

## Purpose
TBD - created by archiving change image-generation-modes. Update Purpose after archive.
## Requirements
### Requirement: Sanitization levels
The extension SHALL support strict, standard, and loose visual-reference sanitization levels.

#### Scenario: Strict sanitization is selected
- **WHEN** strict sanitization processes worldbook or library text
- **THEN** it SHALL remove template macros, database wrappers, rule blocks, configuration-only entries, and low-visual-value content before injection

#### Scenario: Standard sanitization is selected
- **WHEN** standard sanitization processes worldbook or library text
- **THEN** it SHALL remove obvious template/database/rule pollution while preserving likely visual character and scene descriptions

#### Scenario: Loose sanitization is selected
- **WHEN** loose sanitization processes worldbook or library text
- **THEN** it SHALL remove only highly obvious pollution and preserve more user-provided text

### Requirement: Pollution filtering
The extension SHALL prevent non-visual rule/template content from being injected as character or scene reference.

#### Scenario: Template macro content is encountered
- **WHEN** reference text contains template code such as `<%_`, `_%>`, `getMessageVar`, or JavaScript snippets
- **THEN** the sanitizer SHALL exclude those macro/code lines from visual references

#### Scenario: Database wrapper content is encountered
- **WHEN** reference text contains TavernDB wrapper names, readable data table keys, or wrapper start/end markers
- **THEN** the sanitizer SHALL exclude those wrapper entries from visual references

#### Scenario: Rule-only content is encountered
- **WHEN** reference text is primarily insertion rules, task rules, system instructions, fishing rules, enhancement rules, or other non-visual mechanics
- **THEN** the sanitizer SHALL exclude it from character and scene injection

### Requirement: Character visual reference extraction
The extension SHALL normalize character references into named visual descriptions.

#### Scenario: Named character line is found
- **WHEN** a character library entry is formatted as `名字：描述`
- **THEN** the sanitizer SHALL preserve the name and visual description for injection

#### Scenario: Character table row is found
- **WHEN** a table row contains a character name and visual appearance column
- **THEN** the sanitizer SHALL extract a `名字：外貌描述` reference instead of injecting the entire table or surrounding rules

#### Scenario: Character lacks visual information
- **WHEN** a candidate character entry has no usable visual description
- **THEN** the sanitizer SHALL not inject it as fixed appearance unless the user confirms or edits it

### Requirement: Scene visual reference extraction
The extension SHALL prevent character-only or rule-only entries from being injected as scene references.

#### Scenario: Scene entry contains location description
- **WHEN** a scene entry describes a place, environment, time, atmosphere, spatial layout, or visual landmark
- **THEN** the sanitizer SHALL allow it as a scene reference

#### Scenario: Scene candidate is only a character table
- **WHEN** a scene candidate primarily contains character rows or character appearance data
- **THEN** the sanitizer SHALL reject it as a scene reference

#### Scenario: Scene candidate is a rule block
- **WHEN** a scene candidate primarily contains workflow instructions or insertion rules
- **THEN** the sanitizer SHALL reject it as a scene reference

### Requirement: Character source merge
The extension SHALL merge character candidates from character library, current story text, sanitized worldbook entries, and user confirmation.

#### Scenario: Character appears in current story and library
- **WHEN** a character name appears in the current source text and has a matching library entry
- **THEN** the planner SHALL use the library appearance as the fixed visual reference

#### Scenario: Character appears in story but not library
- **WHEN** the current story describes a visible character without a library entry
- **THEN** the planner SHALL create a story-derived visual candidate and mark it as less stable than library-backed references

#### Scenario: User confirms character candidates
- **WHEN** the user confirms or edits candidate characters in the UI
- **THEN** the planner SHALL use the confirmed list for subsequent plan creation

#### Scenario: User deselects a character candidate
- **WHEN** the user deselects a candidate before generation
- **THEN** the planner SHALL omit that candidate from fixed character references unless the source prompt explicitly requires it later

#### Scenario: Confirmation is unavailable
- **WHEN** generation runs through an automatic non-interactive path
- **THEN** the planner SHALL use sanitized configured references and story-derived candidates without blocking generation

#### Scenario: Character appears in current story and current chat profile
- **WHEN** a character name appears in the current source text and has a matching current-chat profile entry
- **THEN** the planner SHALL use the profile appearance as the fixed visual reference and mark its source as `chat library`

#### Scenario: Character appears in story but not profile
- **WHEN** the current story describes a visible character without a current-chat profile entry
- **THEN** the planner SHALL create a story-derived visual candidate and mark it as less stable than profile-backed references

#### Scenario: User persona appears in story but not profile
- **WHEN** the current user/protagonist appears in source text without a current-chat profile entry
- **THEN** the planner SHALL create a persona candidate from available context before marking it as missing
### Requirement: Sanitization diagnostics
The extension SHALL log concise sanitization diagnostics without dumping excessive sensitive text.

#### Scenario: References are filtered
- **WHEN** the sanitizer removes polluted lines or entries
- **THEN** it SHALL log counts and short summaries rather than full unbounded source text

#### Scenario: No usable references remain
- **WHEN** sanitization removes all candidate references for a category
- **THEN** the extension SHALL continue with story-derived references and show a warning status
### Requirement: Chat-scoped visual reference sanitization
Sanitization SHALL operate on the active chat's scoped visual references before using legacy global fallback data.

#### Scenario: Chat-scoped character entry is sanitized
- **WHEN** the active chat contains a character library entry
- **THEN** the sanitizer SHALL process that entry for Visual Bible injection before considering matching legacy global entries

#### Scenario: Chat-scoped scene entry is sanitized
- **WHEN** the active chat contains a scene library entry
- **THEN** the sanitizer SHALL process that entry for Visual Bible injection before considering legacy global scene text

#### Scenario: Chat-scoped entry is rejected
- **WHEN** sanitization rejects polluted chat-scoped reference text
- **THEN** diagnostics SHALL record the rejection and the pipeline MAY fall back to story-derived references or explicit legacy fallback
### Requirement: Missing-reference diagnostics
Sanitization and reference merge SHALL distinguish missing fixed appearances from omitted characters.

#### Scenario: Story character has no fixed appearance
- **WHEN** a visible character appears in source text but no sanitized fixed appearance is available
- **THEN** the character SHALL be retained as story-derived and diagnostics SHALL mark the missing fixed appearance

#### Scenario: Character is intentionally deselected
- **WHEN** the user deselects a character candidate in the active chat
- **THEN** diagnostics SHALL mark the character as omitted by confirmation rather than missing a fixed appearance

#### Scenario: Story character has a candidate but no fixed appearance
- **WHEN** a visible character has no saved fixed appearance but a story-derived or persona-derived candidate exists
- **THEN** diagnostics SHALL mark it as candidate/source-derived rather than plain missing

#### Scenario: Story character has no candidate
- **WHEN** a visible character has no saved fixed appearance and no usable candidate text
- **THEN** the character SHALL be retained as visible and diagnostics SHALL mark the missing fixed appearance
