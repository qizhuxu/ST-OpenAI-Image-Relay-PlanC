## ADDED Requirements

### Requirement: ImagePlan jobs retain preflight context
Every ImageJob created from an ImagePlan SHALL retain enough PromptDraft context for execution, preview, history, and retry.

#### Scenario: Single plan creates job
- **WHEN** a single-image plan creates its ImageJob
- **THEN** the job SHALL retain preflight diagnostics including cleaned source summary, selected visual moment, protected references, risk report, final prompt, and validation state

#### Scenario: Multi plan creates jobs
- **WHEN** a multi-image plan creates jobs from StoryBeat objects
- **THEN** each job SHALL retain its own PromptDraft context scoped to that StoryBeat and the shared Visual Bible

#### Scenario: Comic plan creates jobs
- **WHEN** a comic plan creates jobs from ComicPanel objects
- **THEN** each job SHALL retain its own PromptDraft context including dialogue policy and bubble/model-text state

### Requirement: Legacy raw prompt paths converge on ImageJob preflight
Entry paths that begin with raw prompt strings SHALL converge on ImageJob preflight before requesting images.

#### Scenario: Legacy tag prompt enters pipeline
- **WHEN** a legacy `<pic>` tag provides only a raw prompt string
- **THEN** the extension SHALL wrap that prompt in an ImageJob or equivalent preflight input and SHALL NOT bypass compile, safety classification, or validation

#### Scenario: Summary prompt enters pipeline
- **WHEN** message summarization returns a visual prompt
- **THEN** that prompt SHALL be treated as a visual target for preflight rather than as a final backend prompt

### Requirement: Preflight failure degrades safely
The planning pipeline SHALL degrade safely when a preflight sub-step fails.

#### Scenario: Optional refinement fails
- **WHEN** optional refinement throws, times out, or returns invalid text
- **THEN** the ImageJob SHALL continue with the compiled prompt and record the refinement failure diagnostic

#### Scenario: Safety template fallback fails
- **WHEN** optional template-based safety rewrite fails
- **THEN** the ImageJob SHALL use the latest valid local safe prompt or compiled prompt according to risk classification and SHALL record the safety failure diagnostic
