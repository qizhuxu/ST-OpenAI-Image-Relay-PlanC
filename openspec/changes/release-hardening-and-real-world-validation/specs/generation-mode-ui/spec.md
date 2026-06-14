## ADDED Requirements

### Requirement: Release validation covers workbench and history UI
Release validation SHALL verify the visible UI surfaces most likely to regress during real use.

#### Scenario: Workbench UI is checked
- **WHEN** release validation runs in the browser
- **THEN** it SHALL verify the L2 workbench opens, bounded progress/status areas are present, automatic workflow status is visible, and preview thumbnails do not overflow the floating panel

#### Scenario: Gallery and history UI are checked
- **WHEN** release validation opens the gallery/history tab
- **THEN** it SHALL verify pagination or navigation controls, refresh/clear actions, and lightbox navigation remain usable without vertically wrapped Chinese buttons

#### Scenario: Plugin bubble preview is checked
- **WHEN** release validation uses comic dialogue bubble mode
- **THEN** it SHALL verify dialogue metadata can be rendered or previewed by the plugin without requiring readable in-image text
