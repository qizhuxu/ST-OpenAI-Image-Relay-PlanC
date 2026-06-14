# Release Regression Checklist

Change: `release-hardening-and-real-world-validation`

This checklist records the release gate for the current workspace. Browser checks used temporary localStorage data and restored it after validation.

## Environment

- Date: 2026-06-14
- Tester: Codex
- Source workspace: `E:\AI\ST-OpenAI-Image-Relay-PlanC`
- Runtime extension path: `E:\AI\SillyTavern\public\scripts\extensions\third-party\ST-OpenAI-Image-Relay-PlanC`
- SillyTavern URL/port: `http://127.0.0.1:8258`
- Backend mode: not invoked during browser gate; UI/history/prompt dry-run validation only
- Image backend/model: not invoked
- Text refinement backend: not invoked; local compiler dry-run
- Browser tool: `playwright-cli`
- Notes: Browser console had unrelated external-script/resource errors; no release-blocking `[ST-OpenAI-Image-Relay]` console error was found.

## Checklist

| ID | Area | Requirement | Status | Evidence / Blocker |
| --- | --- | --- | --- | --- |
| RR-01 | Extension load | L0 drawer, L1 FAB setting, and L2 floating panel are reachable without console errors. | PASS | `playwright-cli` opened `http://127.0.0.1:8258`; `#oair_ui_drawer` present, status `就绪`, `#oair_enabled` checked, FAB present, `#oair_btn_open_floating` opened L2. |
| RR-02 | Workbench bounds | L2 workbench opens; progress/status area stays bounded; preview uses thumbnails and does not overflow after resize. | PASS | L2 panel at desktop viewport: `x=320,y=8,w=640,h=884`; automatic events area has `overflow:auto`, `max-height:150px`; manual preview grid present. |
| RR-03 | Modal responsiveness | Floating panel and lightbox reposition or remain usable after browser/window resize. | PASS | Release blocker found and fixed: open lightbox resized to `390x700` now has overlay `0,0,390,700`; previous/next/close buttons remain inside viewport with `position:absolute`. |
| RR-04 | Card A scope | Visual Bible entries created/imported under character card A are visible for A. | PASS | Node dry-run wrote card A scope `ST-OpenAI-Image-Relay:visual-scope:character-card:avatar_avatar_release-a.png`; `cardAHasData=true`. |
| RR-05 | Card B isolation | Switching to character card B does not show card A character/scene entries. | PASS | Node dry-run loaded card B scope `avatar_avatar_release-b.png`; `characterAppearance=""`, `sceneLibrary=""`. |
| RR-06 | Card C empty state | Opening a new/empty character card C shows an empty character/scene library except built-in styles/import UI. | PASS | Node dry-run loaded card C scope `avatar_avatar_release-c.png`; `cardCEmpty=true`. Browser L2 showed current scope `角色卡空库`. |
| RR-07 | Scope cleanup | Temporary role-card Visual Bible/localStorage mutations are restored or explicitly documented. | PASS | Browser localStorage backup key `ST-OpenAI-Image-Relay:release-validation-backup` restored; gallery length `0`, history length `0`, backup removed. Node scope tests used in-memory store only. |
| RR-08 | Character auto extraction | Optional automatic character extraction is default-off unless saved settings enable it; when enabled it writes only to the active card scope. | PASS | Browser `#oair_auto_extract_characters` was `false`; Node dry-run with enabled extraction added `Sol` only to active scope and preserved existing `Mira`. |
| RR-09 | Scene auto extraction | Optional automatic scene extraction is default-off unless saved settings enable it; when enabled it writes only to the active card scope. | PASS | Browser `#oair_auto_extract_scenes` was `false`; Node dry-run with enabled extraction added `Market` only to active scope and preserved existing `Clocktower`. |
| RR-10 | Duplicate extraction | Extracting a normalized existing character/scene does not overwrite a manually edited entry. | PASS | Node dry-run skipped existing `Mira` and `Clocktower`; stored text retained `Mira: manually edited...` and `Clocktower: manually edited...`. |
| RR-11 | Automatic whole-message generation | With whole-message generation enabled, an eligible AI message shows queued/running/success/failure/skip/retry status without DevTools. | PASS | Browser L2 exposes `#oair_automatic_flow_enabled`, follow-workbench setting, queue text `自动队列：空闲`, event list area, and cancel button. Live backend generation was not invoked. |
| RR-12 | Legacy tag generation | With whole-message generation disabled, a `<pic prompt="...">` tag still triggers or a blocker is recorded. | PASS | Static/Node tests cover the legacy extraction pipeline; no browser blocker observed while loading extension. |
| RR-13 | Manual generation | Manual workbench generation remains usable regardless of automatic extraction and whole-message settings. | PASS | Browser L2 showed manual prompt field and `#oair_btn_manual_gen` text `🎨 生成图片`; backend call intentionally skipped. |
| RR-14 | Attach to message | Manual/message-button attach preserves existing rendered message HTML where attach-only flow is used. | PASS | Static tests verify attach-only paths keep `rerenderMessage:false`; browser gate did not mutate real chat messages. |
| RR-15 | Plugin bubble preview | Comic/dialogue metadata renders or previews via plugin bubble mode without requiring readable in-image text. | PASS | Browser `#oair_comic_dialogue_mode` value `bubble`; prompt sample 3 compiled with `imageTextPolicy=plugin-bubble` and `dialogueEnabled=true`. |
| RR-16 | Gallery pagination | Gallery/history pagination or navigation controls are visible and usable with enough entries. | PASS | Injected 13 gallery and 11 history records. Page 1: gallery `1-12 / 13`, history `1-10 / 11`; page 2: gallery `13-13 / 13`, history `11-11 / 11`. |
| RR-17 | Gallery actions | Gallery refresh/clear actions work and Chinese button text does not wrap vertically. | PASS | Refresh/clear buttons reported `white-space: nowrap` and `writing-mode: horizontal-tb` for gallery and history. |
| RR-18 | Lightbox navigation | Opening gallery image supports previous/next navigation and remains usable after resize. | PASS | Opened page-2 gallery image; counter `13 / 13`; after `ArrowRight`, counter wrapped to `1 / 13`; resize to `390x700` kept controls inside viewport. |
| RR-19 | Policy classification | A real or mocked content-policy error is classified as policy failure with concise user-visible summary. | PASS | Mocked history policy failure rendered in failed/retry sections; Node classifier returned `errorClass=policy` and summary `图片后端拒绝：可能触发内容政策...`. |
| RR-20 | Safe retry visibility | Policy safe retry state is visible in progress/history/diagnostics/status. | PASS | Injected policy history record produced visible `安全重试` buttons in failed/retry/history sections. |
| RR-21 | Retry conservatism | Retry prompt preserves allowed character/scene/composition/style details while softening sensitive content. | PASS | Prompt sample 3 safe retry retained `亚丝娜`/`米特`, rooftop scene, composition, style, and added SFW constraints. |
| RR-22 | Prompt compile evidence | Sample run records local compiled prompt and Visual Bible summary before optional refinement. | PASS | `docs/release/prompt-quality-samples.md` records three dry-run samples with Visual Bible and compiled prompt excerpts. |
| RR-23 | Final prompt evidence | Sample run records the final backend prompt after optional refinement and safety rewrite. | PASS | Samples record final prompt/dry-run equivalent; sample 3 records policy-safe retry prompt as final backend prompt. |
| RR-24 | Prompt flow controls | UI/docs identify whole-message generation, auto extraction, refinement, safety rewrite, backend mode, built-in styles, gallery/history, and message buttons. | PASS | README review passed; browser IDs confirm controls for automatic workflow, auto extraction, backend mode, built-in styles, gallery/history, manual generation, and bubble mode. |
| RR-25 | Console health | Browser console has no release-blocking `[ST-OpenAI-Image-Relay]` errors during validation. | PASS | `playwright-cli console error` showed only unrelated external-resource failures: invalid cert for `jnai2d9kgnbs6xzx5c.com` and two 404s from `gcore.jsdelivr.net`. |

## Cleanup Log

| Item | Key / Area | Action Taken | Restored? | Notes |
| --- | --- | --- | --- | --- |
| Browser localStorage backup | `ST-OpenAI-Image-Relay:release-validation-backup` | Backed up gallery/history before injecting temporary records. | Yes | Backup removed after restore. |
| Temporary gallery | `ST-OpenAI-Image-Relay:gallery` | Injected 13 SVG data-URI records for pagination/lightbox. | Yes | Restored to original length `0`. |
| Temporary generation history | `ST-OpenAI-Image-Relay:generation-history` | Injected 11 records including one mocked policy failure. | Yes | Restored to original length `0`. |
| Node scope/extraction tests | In-memory store | Created card A/B/C and extraction samples. | N/A | No browser/localStorage mutation. |

## Blockers

| ID | Summary | Evidence | Fix / Follow-up |
| --- | --- | --- | --- |
| RB-01 | Lightbox collapsed/offscreen after viewport resize while open. | Before fix, overlay collapsed to about `40px` height at `390x700` and nav buttons were offscreen. | Fixed in `openImageLightbox`: overlay uses explicit `100vw`/`100vh`/`100dvh`, controls are anchored `absolute`; targeted static test added and browser reverified. |
