## ADDED Requirements

### Requirement: Release validation covers generation entry paths
Release validation SHALL verify that the primary generation entry paths remain usable before release.

#### Scenario: Automatic whole-message flow is checked
- **WHEN** automatic whole-message generation is enabled in validation
- **THEN** a new eligible AI message SHALL produce visible queued, running, success, failure, skip, or retry status without requiring console inspection

#### Scenario: Legacy tag flow is checked
- **WHEN** automatic whole-message generation is disabled and a `<pic prompt="...">` tag is present
- **THEN** validation SHALL confirm the legacy tag path remains compatible or record a blocker

#### Scenario: Manual generation remains available
- **WHEN** release validation uses the manual workbench
- **THEN** manual generation SHALL remain available regardless of automatic extraction and automatic whole-message settings
