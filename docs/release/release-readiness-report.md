# Release Readiness Report

Change: `release-hardening-and-real-world-validation`

## Decision

- Status: RELEASE-READY after final verification
- Release-ready: Yes, with residual risks listed below
- Decision date: 2026-06-14
- Validator: Codex
- Suggested commit message:
  ```text
  release: harden image relay for real-world validation
  ```

## Scope

This report covers release-hardening validation for the current ST-OpenAI-Image-Relay-PlanC feature set. The pass is verification-first: no broad refactor and no major new feature work. One targeted code fix was made for a browser-validated release blocker in the gallery lightbox.

## Documentation and Version Review

| Item | Expected | Result | Evidence / Notes |
| --- | --- | --- | --- |
| README setup | Covers third-party extension install/runtime sync. | PASS | README has install options, hard refresh guidance, console prefix, and local sync command. |
| README backend config | Covers recommended backend URL/key/model and chat/images mode boundaries. | PASS | README covers universal-web-api defaults, chatgpt2api preset, Chat Completions vs Images API, timeout, endpoint normalization, and response parsing. |
| README default values | Covers built-in styles, default-off auto extraction, prompt flow defaults, gallery/history. | PASS | README states built-in 3 styles, auto extraction default-off, optional whole-message flow default-off, prompt flow, and gallery/history behavior. |
| Prompt flow docs | States local compile is mandatory/non-LLM, refinement optional, safety rewrite conditional, backend receives final prompt. | PASS | README prompt-flow section explicitly documents compile/refine/safety/final backend prompt priority and text-vs-image backend separation. |
| Role-card Visual Bible docs | Explains per-character-card scope isolation and cleanup expectations. | PASS | README uses current role-card scope wording and describes clearing/importing libraries. |
| Troubleshooting | Covers content policy retry, backend failures, extension load, prompt quality diagnostics. | PASS | README troubleshooting covers extension load, backend failures, text-step failures, prompt quality/person consistency diagnostics, and policy retry limits. |
| Version metadata | `manifest.json` version and README change summary are consistent. | PASS | `manifest.json` version is `1.10.0`; README current implementation summary matches the 1.10 feature surface. |

## Automated Verification

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| Main specs | `openspec validate --specs --strict` | PASS | 15 specs passed, 0 failed. |
| Change specs | `openspec validate release-hardening-and-real-world-validation --strict` | PASS | Change is valid. |
| Focused Node tests | `node --test tests\chat_visual_bible.test.mjs tests\prompt_compiler.test.mjs tests\index_pipeline_static.test.mjs tests\policy_retry.test.mjs` | PASS | Covered by final full suite. |
| Full Node tests | `node --test tests\*.mjs` | PASS | 50 tests passed, 0 failed, 0 skipped. |
| Syntax check index | `node --check index.js` | PASS | Exit 0 with no syntax errors. |
| Syntax check compiler | `node --check prompt_compiler.mjs` | PASS | Exit 0 with no syntax errors. |

## Runtime Sync

| Item | Result | Evidence |
| --- | --- | --- |
| Runtime path detected | PASS | `E:\AI\SillyTavern\public\scripts\extensions\third-party\ST-OpenAI-Image-Relay-PlanC`; active runtime port `8258`. |
| Files copied/synced | PASS | Synced `index.js`, `prompt_compiler.mjs`, `manifest.json`, `settings_panel.html`, `settings_full.html`, and `style.css` before browser validation. |
| Hashes verified | PASS | Source/runtime SHA256 prefixes matched after final validation: `index.js` `432D4872ED58`, `prompt_compiler.mjs` `3F4BBA9BD1C4`, `manifest.json` `DF6E91DC8FFA`, `settings_panel.html` `76A7ED0E767A`, `settings_full.html` `F6F84872121E`, `style.css` `EEFF7F8AC5B0`. |

## Browser Validation

| Item | Result | Evidence |
| --- | --- | --- |
| SillyTavern port used | PASS | `playwright-cli open http://127.0.0.1:8258 --headed`. |
| Extension loads | PASS | `#oair_ui_drawer` present; status `就绪`; `#oair_enabled` checked; L2 panel opened from `#oair_btn_open_floating`. |
| Workbench status | PASS | L2 panel visible; automatic queue text `自动队列：空闲`; automatic workflow controls and cancel button present; events area bounded with `max-height:150px`. |
| Gallery/history pagination | PASS | Temporary data: 13 gallery records, 11 history records. Page 1 showed `1-12 / 13` and `1-10 / 11`; page 2 showed `13-13 / 13` and `11-11 / 11`. |
| Lightbox resize/navigation | PASS | Opened image counter `13 / 13`; after mobile resize `390x700`, overlay stayed `0,0,390,700`, controls inside viewport; `ArrowRight` wrapped to `1 / 13`. |
| Policy retry UI | PASS | Mock policy failure appeared in failed/retry sections with visible `安全重试` buttons. |
| Browser mutations restored | PASS | Restored localStorage: gallery length `0`, history length `0`, backup key removed. |
| Console health | PASS | Console errors were unrelated external resources; no release-blocking `[ST-OpenAI-Image-Relay]` error observed. |

See `docs/release/release-regression-checklist.md` for the full checklist.

## Prompt Quality Summary

| Sample | Entry Path | Result | Notes |
| --- | --- | --- | --- |
| Sample 1 | Single image | PASS with improvement | Fixed appearances and scene are present; diagnostics over-detect Chinese phrases as missing characters. |
| Sample 2 | Automatic whole-message | PASS with improvement | Fixed Asuna/Mito and rooftop scene are present; same diagnostic false-positive class. |
| Sample 3 | Comic/dialogue + policy retry | PASS | Bubble mode keeps dialogue out of image text; policy retry preserves character/scene/style while adding SFW constraints. |

Full sample records live in `docs/release/prompt-quality-samples.md`.

## Release Blockers

| ID | Summary | Evidence | Status |
| --- | --- | --- | --- |
| RB-01 | Gallery lightbox collapsed/offscreen after resizing the browser while open. | Browser validation at `390x700` previously produced collapsed overlay and offscreen nav controls. | FIXED. `openImageLightbox` now anchors overlay to `100vw`/`100vh`/`100dvh` and uses internal absolute controls; targeted static test added; browser reverified. |

## Deferred Non-Blocking Issues

| ID | Summary | Reason Deferred | Suggested Change |
| --- | --- | --- | --- |
| DI-01 | Chinese visible-character extraction can produce false-positive missing-character diagnostics. | Does not block release because fixed character/scene prompt content is still present and no prompt-quality sample failed. | Future OpenSpec change to tighten Chinese name extraction with Visual Bible name matching, punctuation boundaries, and stopword/action filters. |
| DI-02 | Real image quality depends on backend/model/account policy behavior. | Browser validation intentionally avoided real generation to keep the release gate reversible and avoid account policy noise. | Run a separate backend-quality pass with a stable backend and non-sensitive samples. |
| DI-03 | Browser validation depends on current local SillyTavern state and installed third-party extensions. | The release gate isolated plugin checks and restored localStorage, but unrelated console noise remains possible. | Keep console filtering by `[ST-OpenAI-Image-Relay]` and document unrelated environment noise. |

## Residual Risks

- Real image outputs may vary by backend/model and provider policy.
- Prompt-quality evaluation is partly subjective; this report uses consistency/provenance criteria to reduce subjectivity.
- The plugin is a browser-side SillyTavern extension with no bundled build/test runner, so runtime validation depends on local ST availability.

## Final Notes

- Final OpenSpec validation: PASS. `openspec validate --specs --strict` returned 15 passed / 0 failed; `openspec validate release-hardening-and-real-world-validation --strict` returned valid.
- Final automated tests: PASS. `node --test tests\*.mjs` returned 50 passed / 0 failed; `node --check index.js` and `node --check prompt_compiler.mjs` exited 0.
- Final browser validation: PASS with `playwright-cli` on `http://127.0.0.1:8258`
- Release recommendation: Release-ready with the deferred non-blocking issues listed above.
