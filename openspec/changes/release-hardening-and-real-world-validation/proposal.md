## Why

The feature set is now broad enough that the next risk is release confidence rather than missing major capability. We need a release-hardening pass that exercises the extension in real SillyTavern workflows, records prompt-quality evidence, and verifies docs/configuration are ready before publishing or committing the current phase.

## What Changes

- Add a release-readiness validation process for ST-OpenAI-Image-Relay-PlanC that focuses on real-world regression coverage rather than new features.
- Define a regression checklist covering A/B/C character-card library isolation, automatic character/scene extraction, automatic whole-message generation, gallery/history pagination, plugin dialogue bubbles, policy retry, and compile/refine/safety prompt flow.
- Define a prompt-quality sample set that records source text, Visual Bible inputs, compiled prompt, final backend prompt, diagnostics, and evaluation notes for consistency and safety behavior.
- Define release documentation checks for README, version metadata, recommended configuration, default values, known limitations, troubleshooting, and local runtime sync instructions.
- Allow small targeted fixes only when validation finds a blocker for real use; no broad refactors or new feature work are in scope.
- Require final verification with OpenSpec validation, Node tests, syntax checks, and `playwright-cli` against the local SillyTavern runtime.

## Capabilities

### New Capabilities
- `release-readiness-validation`: Release-hardening workflow, real-world regression checklist, prompt-quality sample evidence, documentation readiness, verification gates, and final release recommendation.

### Modified Capabilities
- `generation-mode-ui`: Release validation must include bounded workbench UI, gallery/history pagination, plugin bubble preview, and visible automatic workflow status checks.
- `character-card-visual-library-scope`: Release validation must prove A/B/C role-card visual library isolation remains intact.
- `visual-library-auto-extraction`: Release validation must prove optional automatic character and scene extraction writes only to the active role-card scope.
- `image-generation-modes`: Release validation must prove automatic whole-message generation and entry-path behavior remain usable.
- `prompt-compilation`: Release validation must collect prompt-quality samples across compile, optional refinement, safety rewrite, and final backend prompt priority.
- `policy-aware-generation-retry`: Release validation must exercise content-policy failure classification and safe retry behavior.
- `prompt-flow-transparency`: Release validation must confirm user-facing docs still explain compile/refine/safety/backend prompt boundaries.

## Impact

- OpenSpec artifacts under `openspec/changes/release-hardening-and-real-world-validation/`.
- Likely documentation updates in `README.md`, `manifest.json`, or docs if release-readiness gaps are found.
- Possible small fixes in `index.js`, `prompt_compiler.mjs`, `settings_full.html`, `style.css`, and tests only when validation exposes a release-blocking issue.
- Test/runtime verification through existing Node test files and `playwright-cli` against local SillyTavern.
- No new package dependencies, no backend protocol changes, and no large refactor.
