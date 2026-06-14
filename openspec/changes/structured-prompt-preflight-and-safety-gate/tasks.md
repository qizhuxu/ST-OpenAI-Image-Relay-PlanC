## 1. Preflight Tests First

- [x] 1.1 Add failing tests for source cleanup of CSS/HTML, hidden reasoning, stats, choice lists, and safety boilerplate.
- [x] 1.2 Add failing tests for visible versus non-visual character classification and missing-reference diagnostics.
- [x] 1.3 Add failing tests for protected character, scene, style, and dialogue validation around refinement candidates.
- [x] 1.4 Add failing tests for safety risk classification and targeted rewrite of risky character/scene/action fields.
- [x] 1.5 Add failing tests for PromptDraft-aware policy retry and legacy retry fallback.
- [x] 1.6 Add failing tests proving multi StoryBeat and comic ComicPanel jobs retain PromptDraft diagnostics.

## 2. Prompt Preflight Core

- [x] 2.1 Create `prompt_preflight.mjs` with PromptDraft construction, source cleanup, visual moment fallback, and diagnostics helpers.
- [x] 2.2 Implement visible/non-visual character classification helpers and protected reference normalization.
- [x] 2.3 Implement final prompt validation for protected characters, protected scenes, dialogue policy, and empty prompt fallback.
- [x] 2.4 Implement bounded refinement acceptance/rejection helpers.
- [x] 2.5 Implement mandatory risk classification and targeted safety rewrite helpers.
- [x] 2.6 Implement PromptDraft-aware policy retry prompt creation.

## 3. Pipeline Integration

- [x] 3.1 Wire single-image plan/job finalization through Prompt Preflight.
- [x] 3.2 Wire manual workbench generation and manual refinement preview through compiled/preflight prompts.
- [x] 3.3 Wire automatic whole-message generation through Prompt Preflight.
- [x] 3.4 Wire legacy `<pic prompt="...">` extraction through Prompt Preflight.
- [x] 3.5 Wire per-message generation and summarize-and-generate actions through Prompt Preflight.
- [x] 3.6 Wire multi-image StoryBeat jobs and comic ComicPanel jobs through Prompt Preflight.
- [x] 3.7 Wire policy retry to reuse PromptDraft context while preserving the existing legacy fallback.
- [x] 3.8 Ensure generation history, gallery records, progress cards, and console logs retain concise preflight diagnostics without base64 or unbounded source text.

## 4. Template UI And Documentation

- [x] 4.1 Change default Chat Completions and Images API image templates to direct `{{prompt}}` substitution while preserving backend preset compatibility.
- [x] 4.2 Reorganize or relabel prompt-template UI sections as required, compatibility, advanced post-processing, and inactive/deprecated controls.
- [x] 4.3 Hide, remove, or clearly mark the cleanup template as inactive/reserved without breaking saved settings.
- [x] 4.4 Synchronize `settings_full.html` and the inline `SETTINGS_FULL_HTML` fallback in `index.js`.
- [x] 4.5 Update README and relevant docs to explain Prompt Preflight, mandatory compilation, optional refinement, mandatory classification, conditional rewrite, and PromptDraft policy retry.

## 5. Verification And Browser Smoke

- [x] 5.1 Run `openspec validate structured-prompt-preflight-and-safety-gate --strict` after implementation.
- [x] 5.2 Run all Node tests and ensure the new preflight tests pass.
- [x] 5.3 Sync changed extension files into `../SillyTavern/public/scripts/extensions/third-party/<folder>/`.
- [x] 5.4 Use browser or playwright-cli against local SillyTavern (`http://127.0.0.1:8258` from `../SillyTavern/config.yaml`; old docs mention `8528`) to smoke-test manual single, automatic whole-message, legacy `<pic>`, message button, multi, comic, gallery/history, and safety retry/log visibility.
- [x] 5.5 Review browser console for `[ST-OpenAI-Image-Relay]` errors and verify logs include compile, refinement, safety classification, and final prompt summaries.

## 6. Closeout

- [x] 6.1 Update this task list as tasks complete and confirm all OpenSpec artifacts are current.
- [x] 6.2 Run final `git status` and confirm `AGENTS.md` remains untracked and unstaged.
- [x] 6.3 Commit all relevant changes except `AGENTS.md` with a clear message.
