## Context

ST-OpenAI-Image-Relay-PlanC now has a wide feature surface: role-card Visual Bible scopes, automatic library extraction, prompt compilation, optional refinement, safety rewrite, policy retry, automatic whole-message generation, gallery/history, and comic dialogue bubbles. The active OpenSpec backlog has been archived and the main specs validate, so the next step is a release-hardening pass that proves the current implementation works in real SillyTavern usage.

This change is intentionally verification-first. It should not introduce broad new behavior. It should create evidence, fix only release-blocking issues, and leave a clear release recommendation.

## Goals / Non-Goals

**Goals:**
- Establish a real-world regression checklist for the current feature set.
- Establish a prompt-quality sample set that records source text, Visual Bible, compiled prompt, final prompt, diagnostics, and result notes.
- Check README, manifest version, recommended settings, default values, known limitations, troubleshooting, and runtime sync instructions for release readiness.
- Run OpenSpec validation, Node tests, syntax checks, and `playwright-cli` runtime validation against local SillyTavern.
- Fix only concrete blockers found during validation.
- Produce a final release decision, residual risks, and suggested commit message.

**Non-Goals:**
- No new major features.
- No large refactor of `index.js` or the prompt compiler.
- No backend protocol redesign.
- No automatic deletion or migration of user data.
- No policy bypass or weakening of safety handling.

## Decisions

### Decision: Treat this as a release gate, not a feature change

The main artifact of this change is evidence: checklists, sample prompts, test results, runtime observations, and a release decision. Code changes are allowed only when validation finds a blocker that prevents real use.

Alternative considered: continue adding new controls or prompt features. That would increase uncertainty and delay release confidence.

### Decision: Validate with a small but representative matrix

Use a compact real-world matrix rather than exhaustive manual testing. The matrix must include at least:
- Three character-card identities for A/B/C scope isolation.
- One conversation sample with characters and scenes for automatic extraction.
- One automatic whole-message generation path.
- One gallery/history pagination or navigation check.
- One comic dialogue bubble sample.
- One simulated or real policy-retry case.
- One prompt-flow sample with compile, optional refinement state, safety state, and final backend prompt.

Alternative considered: validate every combination of mode, backend, count, and policy. That is too slow for release hardening and belongs in future automated coverage.

### Decision: Store prompt-quality samples as lightweight documentation

Prompt-quality samples should be recorded in a small markdown or JSON document under `docs/` or the OpenSpec change directory. They should not store image bytes or sensitive user data. Each sample should capture enough text to compare consistency and diagnose prompt regressions.

Alternative considered: store generated images in the repo. That would bloat the repository and mix user/runtime artifacts with source.

### Decision: Keep runtime validation reversible

Browser validation should avoid permanent user data changes. When localStorage, role-card visual scopes, gallery indexes, or settings are changed for tests, back them up and restore them before completion whenever possible.

Alternative considered: validate directly in the user's active chats without cleanup. That risks contaminating real role-card libraries and makes results hard to trust.

### Decision: Release docs must match current product boundaries

README and related docs must state that local compilation is mandatory, LLM refinement is optional, safety rewrite is conditional, and image backends receive only the final prompt. Docs must also explain built-in styles, automatic extraction defaults, role-card scope isolation, automatic workflow status, and known limitations.

Alternative considered: keep docs minimal and rely on UI labels. The plugin now has enough moving parts that release users need a clear guide.

## Risks / Trade-offs

- [Risk] Browser validation may depend on the user's current SillyTavern state. Mitigation: use temporary test data where possible, record the active port and state assumptions, and restore test mutations.
- [Risk] Prompt-quality evaluation is partly subjective. Mitigation: use fixed sample fields and evaluate consistency, missing references, safety behavior, and final prompt provenance rather than taste alone.
- [Risk] A real image backend may be unavailable or policy-limited. Mitigation: use mocked policy failure where possible, record backend availability, and distinguish runtime UI validation from backend quality validation.
- [Risk] Scope creep can turn hardening into feature work. Mitigation: only fix explicit blockers; defer enhancements to new OpenSpec changes.
- [Risk] Documentation drift can reappear after fixes. Mitigation: rerun doc/static checks and include docs in final verification.

## Migration Plan

1. Create release-hardening OpenSpec artifacts and validate them.
2. Add or update lightweight release checklist/sample documentation.
3. Run existing Node and syntax checks to establish baseline.
4. Sync extension files to the local SillyTavern runtime folder.
5. Use `playwright-cli` to execute the real-world validation matrix.
6. Fix only release blockers discovered during validation.
7. Rerun OpenSpec validation, Node tests, syntax checks, and targeted browser checks.
8. Produce final release decision, residual risks, and suggested commit message.

Rollback is simple because this change should mostly add documentation and test evidence. Any code fixes should be small and reversible.

## Open Questions

- Which real image backend will be used for the optional quality sample that requires actual generation?
- Should prompt-quality samples live under `docs/release/` or inside the OpenSpec change directory until the change is archived?
