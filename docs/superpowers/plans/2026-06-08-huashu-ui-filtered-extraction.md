# Huashu Task-Oriented UI + Filtered Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the L2 floating settings UI into Huashu-style task tabs, split character/scene worldbook strategies, and fix noisy worldbook extraction with typed filtering plus candidate confirmation.

**Architecture:** Keep storage compatible with existing text libraries (`名字：描述`) and hidden fields, but reorganize UI tabs around user tasks: overview, backend, text model, templates, style, character, scene, generation/gallery. Add `characterWorldBookMode` and `sceneWorldBookMode` while preserving legacy `worldBookMode`; worldbook extraction becomes filter → candidate modal → confirm merge, instead of direct merge.

**Tech Stack:** Vanilla ES module loaded by SillyTavern, jQuery UI wiring, CSS in `settings_full.html` + `style.css`, inline HTML fallback in `index.js`; verification via `node --check`, temporary `.mjs` assertions, and browser manual checklist.

---

## Files

- Modify `index.js`: settings defaults, tab map, UI bindings, modal candidate workflow, typed worldbook filtering, character/scene mode gating, inline HTML regeneration.
- Modify `settings_full.html`: task-oriented tabs and Huashu card layout.
- Modify `style.css`: Huashu visual refinements for task cards, summaries, modals.
- Modify `CLAUDE.md`: update UI architecture and worldbook extraction notes.
- Create temporary verification scripts only; delete before completion.

## Tasks

### Task 1: Add split worldbook mode model
- Add defaults: `characterWorldBookMode`, `sceneWorldBookMode`.
- Add helpers: `libraryWorldBookMode(settings, kind)`, `normalizeWorldBookModes(settings)`.
- Ensure `ensureSettings()` migrates legacy `worldBookMode/worldBookEnabled` into both split modes.
- Update gather functions to use kind-specific mode.

### Task 2: Rebuild settings_full.html tabs
- Replace current 7-tab bar with 8 task tabs: 总览, 后端, 文本模型, 模板, 风格, 人物, 场景, 生成.
- Keep internal radio/CSS selectors in sync.
- Move existing controls into their task tab without changing IDs where possible.
- Merge manual generation and gallery into 生成 tab.

### Task 3: Wire tab map and UI sync
- Update `tabMap` in `loadFullSettings` and `toggleFloatingPanel` to new IDs.
- Bind new character/scene worldbook radio groups.
- Update overview cards from current settings.

### Task 4: Filtered worldbook extraction
- Add `classifyWorldBookEntry(entry, kind, headings)` returning score/reason/section/name.
- Add `extractWorldBookCandidates(kind)` with rules for character vs scene.
- Change `extractLibraryFromWorldBook(kind)` to open candidate modal instead of direct merge.
- Candidate modal supports checkbox, edit name/body, confirm merge, cancel.

### Task 5: Verify extraction and scene pipeline
- Pure tests for worldbook mode migration, classifier filtering, candidate JSON parsing, `{{scenes}}` rendering.
- `node --check`.
- Verify inline `SETTINGS_FULL_HTML` equals external `settings_full.html`.

### Task 6: Docs and manual checklist
- Update `CLAUDE.md` with new tab layout, split worldbook modes, candidate extraction, and scene pipeline.
- Provide browser checklist.

## Validation

```bash
cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && rm -f tmp_syntax.mjs
node tmp_huashu_test.mjs
node tmp_verify_inline.mjs
```

Expected: all pass, no temp files left.
