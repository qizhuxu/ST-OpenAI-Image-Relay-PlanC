## ADDED Requirements

### Requirement: PromptDraft-aware policy retry
Policy-safe retry SHALL use the failed job's PromptDraft context when available.

#### Scenario: Policy retry uses draft
- **WHEN** an ImageJob fails with error class `policy` and has PromptDraft context
- **THEN** the safe retry prompt SHALL be generated from the draft's protected references, visual moment, risk report, and latest accepted prompt rather than from a bare prompt string alone

#### Scenario: Policy retry preserves allowed anchors
- **WHEN** a policy-safe retry prompt is created from a PromptDraft
- **THEN** it SHALL preserve allowed character names, SFW appearance anchors, scene anchors, style anchors, composition, and dialogue policy while softening risky fields

#### Scenario: Policy retry has no draft
- **WHEN** an older or degraded ImageJob lacks PromptDraft context
- **THEN** the extension SHALL fall back to the existing conservative safe retry prompt behavior and record that the retry used legacy context

#### Scenario: Retry remains capped
- **WHEN** an ImageJob has already used one policy-safe retry
- **THEN** the extension SHALL NOT automatically retry it again
