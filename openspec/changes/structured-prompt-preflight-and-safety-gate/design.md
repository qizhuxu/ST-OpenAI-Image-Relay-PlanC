## Context

The extension already has ImagePlan/ImageJob objects, a local `prompt_compiler.mjs`, optional LLM refinement, graded safety rewrite, character-card visual libraries, and policy-aware retry. The weak point is the boundary before image backend calls: several entry paths still treat prompts as mutable strings, and `optimizePrompt()` / `sanitizePrompt()` can overwrite the compiler output without knowing which character, scene, dialogue, and safety fields are protected.

The requested change makes prompt preparation a structured preflight step. Every image entry path must produce a PromptDraft before the backend sees a prompt. The draft records cleaned source text, selected visual moment, visible and non-visual characters, scoped Visual Bible references, compile diagnostics, optional refinement output, safety findings, final validation, and retry context.

The project remains a SillyTavern browser extension with no build step. The implementation must keep `settings_full.html` and the inline `SETTINGS_FULL_HTML` fallback synchronized when UI changes.

## Goals / Non-Goals

**Goals:**

- Route automatic whole-message generation, legacy `<pic>`, manual workbench, message buttons, summarization, multi image, and comic image jobs through one Prompt Preflight Pipeline.
- Make local compilation the authority for what is drawn.
- Keep optional LLM refinement bounded to expression quality, not visual intent.
- Classify prompt risks before rewriting and rewrite only risky fields while preserving protected character, scene, style, and dialogue invariants.
- Build policy-safe retry prompts from the same PromptDraft context instead of from a bare string.
- Make prompt-template UI labels match actual runtime importance: required backend/planning templates, compatibility controls, advanced refinement/safety controls, and inactive/deprecated templates.
- Add tests around source cleanup, visible/non-visual character separation, protected references, fallback on bad refinement, targeted safety rewrite, policy retry, and multi/comic planning.

**Non-Goals:**

- No new backend protocol or image-edit API integration.
- No framework, bundler, TypeScript, or dependency migration.
- No attempt to make image models render Chinese text reliably; plugin bubble mode remains the preferred readable dialogue path.
- No archival of the OpenSpec change in this task; archive can happen after the implementation has settled.

## Decisions

### 1. Add `prompt_preflight.mjs` as the orchestration boundary

`prompt_compiler.mjs` should stay focused on deterministic prompt compilation. A new `prompt_preflight.mjs` will own source cleanup, draft assembly, validation, refinement guards, safety classification, targeted rewrite helpers, and policy retry prompt creation.

Alternative considered: keep expanding `prompt_compiler.mjs`. That would blur deterministic compilation with LLM/safety concerns and make the compiler harder to test as a pure local component.

### 2. Use PromptDraft as the single pre-backend data contract

Every ImageJob will retain prompt preflight diagnostics. The draft shape is intentionally plain JSON-friendly:

```js
{
  sourceText,
  cleanedText,
  mode,
  visualMoment,
  visibleCharacters,
  nonVisualCharacters,
  protectedCharacters,
  protectedScenes,
  protectedStyle,
  dialoguePolicy,
  compiledPrompt,
  refinedPrompt,
  safetyPrompt,
  finalPrompt,
  riskReport,
  validation
}
```

Alternative considered: keep only string prompt plus diagnostics. That would not let safety rewrite distinguish risky source fields from protected Visual Bible fields and would not support reliable retry.

### 3. Compile first, refine second, validate always

The preflight step compiles locally before optional refinement. Refinement may improve composition, lighting, camera language, repetition, and quality hints. It must not add/remove visible characters, replace protected appearances, change selected scene, or change dialogue policy. If validation finds that refinement broke invariants, the job falls back to the compiled prompt and records the fallback reason.

Alternative considered: keep old string refinement and trust the template. That is the current failure mode.

### 4. Safety becomes classification plus targeted rewrite

Safety classification is mandatory and non-LLM by default. It records risk sources: source text/action, character references, scene references, style text, compiled prompt, or refined prompt. Safety rewrite runs only when risk is found or when a policy retry needs it. Rewriting should prefer local field-level softening for known risky patterns and use the configured safety template only as an advanced fallback when needed.

Alternative considered: keep unconditional LLM whole-prompt safety rewrite. That can erase identity and scene consistency, especially when a risky detail appears inside one library field.

### 5. Policy retry reuses PromptDraft context

When backend error classification returns `policy`, safe retry builds from the job's latest PromptDraft. It should preserve allowed subject, composition, style, scoped Visual Bible names, and dialogue policy while softening only risky elements. Retry count remains capped at one.

Alternative considered: rewrite `job.prompt` with a generic suffix. That cannot know which references are protected or which risky fields were already rewritten.

### 6. Template UI is clarified, not removed abruptly

Backend prompt templates should default to direct `{{prompt}}`. The cleanup template is inactive and should be hidden or clearly marked as reserved. Main prompt injection and extraction regex remain compatibility controls for legacy `<pic>` mode. Refinement, safety, and summarization templates move conceptually to advanced post-processing controls.

Alternative considered: remove advanced templates entirely. That would break users with custom backends and workflows.

## Risks / Trade-offs

- PromptDraft adds another abstraction -> keep it serializable, small, and covered by focused tests.
- Source cleanup can accidentally remove useful prose -> preserve `cleanedText` and diagnostics, and fall back to original source when cleanup leaves no useful visual text.
- Local safety heuristics can be incomplete -> retain advanced template fallback and policy retry, and test the high-risk patterns already observed.
- UI synchronization is easy to miss -> treat `settings_full.html` and inline `SETTINGS_FULL_HTML` as part of the same task and add static tests where feasible.
- Browser validation may depend on local SillyTavern state -> run static/node tests first, then use browser/playwright for smoke coverage and report any environment-specific limitations honestly.

## Migration Plan

1. Add PromptDraft/preflight utilities and tests without changing backend dispatch.
2. Wire single-image job finalization through preflight.
3. Wire multi/comic jobs and legacy/manual/message/summarize paths through preflight.
4. Replace policy retry prompt creation with PromptDraft-aware creation while preserving the old fallback for old jobs.
5. Update template defaults/labels and documentation.
6. Run OpenSpec validation, Node tests, sync to local SillyTavern, and perform browser smoke tests.

Rollback is straightforward because backend request functions still accept final prompt strings. If preflight fails unexpectedly, the implementation should fall back to the compiled prompt and record diagnostics rather than block generation.
