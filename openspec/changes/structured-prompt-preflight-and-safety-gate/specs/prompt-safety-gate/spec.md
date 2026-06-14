## ADDED Requirements

### Requirement: Mandatory prompt risk classification
The extension SHALL classify prompt safety risks before any optional safety rewrite or image backend request.

#### Scenario: Risk-free prompt is classified
- **WHEN** a compiled prompt and its protected references contain no detected safety risks
- **THEN** the risk report SHALL mark the prompt as safe and safety rewrite SHALL NOT run unless explicitly forced by retry or settings

#### Scenario: Character reference contains risky sexualized minor-coded wording
- **WHEN** a protected character reference combines minor-coded terms with sexualized, nude, exposed, or erotic wording
- **THEN** the risk report SHALL attribute that risk to the character reference and SHALL require an adult, SFW, non-explicit rewrite before backend dispatch

#### Scenario: Scene reference contains risky gore or explicit harm
- **WHEN** a protected scene reference contains gore, dismemberment, severe injury, or explicit abuse detail
- **THEN** the risk report SHALL attribute that risk to the scene reference and SHALL require targeted softening while preserving allowed location and atmosphere anchors

#### Scenario: Story action contains risky content
- **WHEN** source action or compiled action text contains explicit sexual content, nudity, gore, severe injury, or exploitative framing
- **THEN** the risk report SHALL attribute that risk to the action/source field and SHALL preserve allowed non-graphic tension when rewriting

### Requirement: Targeted safety rewrite
Safety rewriting SHALL modify only risky fields needed to produce an SFW image prompt while preserving protected visual consistency.

#### Scenario: Risk comes from one character reference
- **WHEN** only one protected character reference is risky
- **THEN** the rewrite SHALL sanitize that character description and SHALL NOT rewrite unrelated safe characters, scene anchors, style anchors, or dialogue policy

#### Scenario: Minor-coded sexualized fantasy character is rewritten
- **WHEN** a fantasy character description includes minor-coded sexualized wording
- **THEN** the rewrite SHALL keep non-explicit identifying fantasy anchors such as hair color, horns, tail, role, and personality tone while changing the presentation to adult-coded, clothed, and SFW

#### Scenario: Non-graphic conflict is rewritten
- **WHEN** a prompt contains allowed action tension, weapons, pursuit, confrontation, or fantasy props without gore or explicit injury
- **THEN** safety rewrite SHALL preserve the action choreography and cinematic tension rather than turning the image into an unrelated daily portrait

#### Scenario: Safety template fallback is used
- **WHEN** local targeted rewrite cannot produce a valid safe candidate
- **THEN** the extension MAY use the configured safety template as an advanced fallback and SHALL still validate protected references before accepting the result

### Requirement: Safety diagnostics
The extension SHALL retain concise safety diagnostics for preview, history, retry, and debugging.

#### Scenario: Rewrite changes prompt
- **WHEN** safety rewrite changes any draft field or final prompt
- **THEN** diagnostics SHALL record safety level, changed risk sources, whether local or template fallback was used, and whether validation accepted or rejected the candidate

#### Scenario: Rewrite is skipped
- **WHEN** risk classification finds no relevant risk and safety rewrite is skipped
- **THEN** diagnostics SHALL record that classification ran and found no rewrite-required risk
