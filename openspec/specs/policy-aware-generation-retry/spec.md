# policy-aware-generation-retry Specification

## Purpose
Synced from OpenSpec change deltas. Update Purpose after review.

## Requirements
### Requirement: Backend error classification
The extension SHALL classify backend image generation failures into stable error classes for UI, history, and retry behavior.

#### Scenario: Content policy violation is returned
- **WHEN** the backend error payload or message contains `content_policy_violation` or an equivalent policy refusal message
- **THEN** the ImageJob SHALL be marked with error class `policy`
- **AND** the UI SHALL show a concise Chinese policy-refusal summary

#### Scenario: Non-policy backend error is returned
- **WHEN** the backend returns another structured error
- **THEN** the ImageJob SHALL preserve a concise error summary without treating it as policy-retryable

#### Scenario: Network or parse error occurs
- **WHEN** the request fails before a structured backend response is parsed
- **THEN** the ImageJob SHALL be classified as `network`, `parse`, or `backend` according to the available evidence
### Requirement: Safe policy retry
The extension SHALL provide a safe retry path for policy refusals without bypassing backend policy.

#### Scenario: Policy failure is retryable
- **WHEN** an ImageJob fails with error class `policy` and has not already used a safe retry
- **THEN** the extension SHALL create a conservative SFW rewrite of the prompt and retry at most once automatically or via a visible `安全重试` action

#### Scenario: Safe retry rewrites prompt
- **WHEN** a safe retry prompt is created
- **THEN** it SHALL reduce violent, sexual, gore, exploitative, or otherwise sensitive detail while preserving allowed subject, composition, style, and current Visual Bible consistency
- **AND** it SHALL NOT ask the backend to ignore, bypass, or evade content policy

#### Scenario: Safe retry fails
- **WHEN** the safe retry also fails
- **THEN** the UI SHALL keep the failed job card visible with the final error summary and SHALL NOT enter an infinite retry loop
### Requirement: Policy retry diagnostics
Policy retry behavior SHALL be visible in ImageJob metadata and generation history.

#### Scenario: Job is retried safely
- **WHEN** a policy-safe retry runs
- **THEN** ImageJob metadata SHALL include policy retry count, original error class, and whether the final prompt was safety-rewritten

#### Scenario: History record is written
- **WHEN** a plan containing policy failures or safe retries is recorded
- **THEN** the lightweight history record SHALL include concise policy retry diagnostics without storing unbounded raw error payloads
