# 预设库弹窗 + 场景库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the settings library redesign: style/person/scene libraries use modal list management, person/scene extraction from chat and worldbook works, worldbook injection/extraction modes are mutually exclusive, and scene settings participate in prompt optimization/degrade paths.

**Architecture:** Keep existing text storage format (`名字：描述`) for compatibility, but hide direct textareas and expose modal list editors. Add scene fixed settings beside style/characters in `resolveFixedSettings`, `renderOptimizeTemplate`, and `appendFixedBlock`; use `worldBookMode` to decide whether worldbook is an injection source or extraction-only source.

**Tech Stack:** Vanilla browser ES module for SillyTavern, jQuery, SillyTavern `getContext()`/`generateRaw`/`loadWorldInfo`; verification by `node --check` plus temporary `.mjs` pure-function assertions and browser hand testing.

---

## Tasks

1. Normalize settings/model: ensure `worldBookMode`, `sceneLibrary`, `sceneActive`, `sceneAutoSelect` defaults and compatibility helpers exist.
2. Complete modal list editor helpers: parse/serialize library entries, render summaries, open editor modal, merge extracted candidates.
3. Complete extraction helpers: worldbook extraction and chat extraction for person/scene candidate JSON.
4. Wire UI events for style/person/scene management and extraction buttons; ensure `settings_full.html` and inline `SETTINGS_FULL_HTML` stay synchronized.
5. Extend prompt pipeline: `{{scene}}`, scene resolution, analysis scene field, `appendFixedBlock` scene output, worldbook mode gating.
6. Verify with pure-function scripts, `node --check`, and update CLAUDE.md/manifest if needed.

## Verification

- `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && rm -f tmp_syntax.mjs`
- Temporary `.mjs` assertions for serialization, mode compatibility, parse extraction JSON, render `{{scene}}`.
- Manual ST browser checks for modals, extraction buttons, `inject` vs `extract`, scene injection.
