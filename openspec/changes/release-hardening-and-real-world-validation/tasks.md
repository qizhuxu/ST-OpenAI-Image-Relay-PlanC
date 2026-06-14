## 1. OpenSpec Planning

- [x] 1.1 Validate this change with `openspec validate release-hardening-and-real-world-validation --strict`.
- [x] 1.2 Re-read apply instructions and all change artifacts before starting release validation.

## 2. Release Evidence Artifacts

- [x] 2.1 Create a release regression checklist document covering A/B/C role-card isolation, automatic extraction, automatic whole-message generation, gallery/history pagination, plugin bubbles, policy retry, and prompt flow.
- [x] 2.2 Create a prompt-quality sample set template that records source text, Visual Bible summary, compiled prompt, final backend prompt, diagnostics, and evaluation notes.
- [x] 2.3 Create a release-readiness report template for final decision, residual risks, deferred issues, and suggested commit message.

## 3. Documentation and Version Review

- [x] 3.1 Review `README.md`, `manifest.json`, and any linked docs for setup, runtime sync, defaults, recommended backend settings, known limitations, troubleshooting, and prompt-flow explanation.
- [x] 3.2 Update documentation or release notes only for concrete release-readiness gaps found during review.
- [x] 3.3 Record documentation and version findings in the release-readiness report.

## 4. Automated Verification

- [x] 4.1 Run `openspec validate --specs --strict` and record the result.
- [x] 4.2 Run `openspec validate release-hardening-and-real-world-validation --strict` and record the result.
- [x] 4.3 Run focused Node tests for Visual Bible, prompt compiler, static UI/pipeline, and policy retry behavior.
- [x] 4.4 Run the full available Node test suite and JavaScript syntax checks for `index.js` and `prompt_compiler.mjs`.

## 5. Runtime Sync and Browser Validation

- [x] 5.1 Sync extension files into the local SillyTavern third-party runtime folder and verify hashes.
- [x] 5.2 Use `playwright-cli` to open the available local SillyTavern port and confirm the extension loads.
- [x] 5.3 Validate the real-world regression checklist items that require browser state, restoring temporary settings or localStorage mutations afterward.
- [x] 5.4 Record browser validation evidence, port used, skipped items, and blockers in the release-readiness report.

## 6. Prompt Quality Sample Review

- [x] 6.1 Capture at least three representative prompt-quality samples: single image, automatic whole-message, and comic/dialogue or policy-retry adjacent flow.
- [x] 6.2 For each sample, record source text, Visual Bible summary, compiled prompt, final backend prompt or dry-run equivalent, diagnostics, and evaluation notes.
- [x] 6.3 Identify prompt-quality blockers versus non-blocking improvement ideas.

## 7. Blocker Fixes

- [x] 7.1 If validation finds release-blocking issues, make only targeted fixes tied to the failing checklist item.
- [x] 7.2 Add or update focused tests for any targeted blocker fix.
- [x] 7.3 Re-run the affected automated and browser validation after each blocker fix.

## 8. Final Release Decision

- [x] 8.1 Complete the release-readiness report with release-ready or blocked status, residual risks, deferred issues, and suggested commit message.
- [x] 8.2 Run final OpenSpec and test verification after all fixes or documented skips.
- [x] 8.3 Update this task list to reflect completed validation work and remaining blockers, if any.
