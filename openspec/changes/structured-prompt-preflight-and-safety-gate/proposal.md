## Why

The current prompt preparation path still lets generic LLM string transforms overwrite compiled prompts, which can erase fixed character appearances, scene libraries, dialogue policy, and policy-safe retry context. Image generation needs a single structured preflight step before every backend request so prompt quality, safety, and Visual Bible consistency are controlled by local compilation and validation rather than by unbounded optimize/safety rewrites.

## What Changes

- Add a unified Prompt Preflight Pipeline used by every image-generation entry path before any backend request.
- Introduce a structured PromptDraft model that separates source cleanup, visual moment selection, visible/non-visual characters, protected Visual Bible references, safety findings, compiled text, optional refinement, and final backend prompt.
- Upgrade prompt compilation so local compilation is the required authority for what to draw, while LLM refinement becomes an optional, bounded post-compile enhancement.
- Replace whole-prompt safety rewriting with risk classification, targeted safe field rewriting, final prompt validation, and PromptDraft-based policy retry.
- Clean up prompt-template semantics and UI so required backend/planning templates, compatibility controls, advanced refinement/safety controls, and deprecated placeholders are clearly separated.
- Preserve character-card visual library isolation while ensuring preflight reads only the active character card/current visual scope.
- Update documentation, diagnostics, tests, and real-browser validation around the new prompt flow.

## Capabilities

### New Capabilities

- `prompt-preflight`: Defines the unified pre-backend PromptDraft pipeline, source cleanup, protected fields, final validation, and entry-path convergence.
- `prompt-safety-gate`: Defines risk classification, targeted safety rewriting, protected-reference preservation, and safe PromptDraft-based retry inputs.

### Modified Capabilities

- `prompt-compilation`: Local compilation becomes the required source of prompt truth and must preserve protected character/scene/style/dialogue invariants through refinement and safety steps.
- `image-planning-pipeline`: Every ImagePlan/ImageJob entry path must run through preflight before execution and retain PromptDraft diagnostics for preview, history, and retry.
- `policy-aware-generation-retry`: Policy retry must reuse the same PromptDraft/protected-reference context and retry at most once with a conservative SFW prompt.
- `generation-mode-ui`: Prompt-template controls must distinguish required, compatibility, advanced, and deprecated templates; cleanup template must be hidden, removed, or clearly marked as inactive.
- `prompt-flow-transparency`: README/docs/UI diagnostics must state that compilation is mandatory, refinement is optional, safety classification is mandatory, and safety rewrite is conditional.
- `character-card-visual-library-scope`: Preflight must read style, character, and scene libraries only from the active character-card/current visual scope and must not leak stale libraries into a new card.

## Impact

- Affected code: `index.js`, `prompt_compiler.mjs`, new `prompt_preflight.mjs`, `settings_full.html`, inline `SETTINGS_FULL_HTML`, `style.css` if UI styling changes, tests under `tests/`.
- Affected docs: `README.md`, OpenSpec specs/tasks/design, and any prompt-flow release notes or diagnostics docs touched by the implementation.
- Runtime behavior: all image entry paths converge on Prompt Preflight; backend prompt templates default to direct `{{prompt}}`; unsafe or invalid refined prompts fall back to locally compiled prompts.
- No build-system or framework changes; the extension remains a SillyTavern vanilla ES module loaded by `manifest.json`.
