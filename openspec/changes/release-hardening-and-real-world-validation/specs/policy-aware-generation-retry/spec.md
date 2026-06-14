## ADDED Requirements

### Requirement: Release validation covers policy retry
Release validation SHALL verify content-policy failure handling and safe retry visibility before release.

#### Scenario: Policy failure is classified
- **WHEN** a backend response or mock error contains content-policy violation text
- **THEN** validation SHALL confirm the job is classified as a policy failure with a concise user-visible summary

#### Scenario: Safe retry is visible
- **WHEN** a policy-safe retry is available or triggered
- **THEN** validation SHALL confirm retry state is visible in progress, history, diagnostics, or automatic workflow status

#### Scenario: Retry remains conservative
- **WHEN** a safe retry prompt is generated
- **THEN** it SHALL preserve allowed character, scene, composition, and style details while removing or softening policy-sensitive content
