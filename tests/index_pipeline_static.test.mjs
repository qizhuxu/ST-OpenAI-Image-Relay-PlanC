import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const fullSettingsSource = readFileSync(new URL("../settings_full.html", import.meta.url), "utf8");
const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("manual single generation does not force LLM refinement by default", () => {
  const branchStart = indexSource.indexOf("// 单图模式：先规划并编译");
  assert.notEqual(branchStart, -1, "manual single branch should be present");

  const branchEnd = indexSource.indexOf("prompt = result.jobs?.[0]?.prompt || prompt;", branchStart);
  assert.notEqual(branchEnd, -1, "manual single branch should preserve final prompt assignment");

  const branch = indexSource.slice(branchStart, branchEnd);
  assert.match(branch, /skipOptimize:\s*!!optimizedText/);
  assert.match(branch, /forceOptimize:\s*false/);
  assert.doesNotMatch(branch, /forceOptimize:\s*!optimizedText/);
});

test("message block refreshes go through host-safe wrapper", () => {
  assert.match(indexSource, /async function updateMessageBlockWhenReady/);

  const wrapperStart = indexSource.indexOf("async function updateMessageBlockWhenReady");
  const wrapperEnd = indexSource.indexOf("\nfunction updateFabStatus", wrapperStart);
  assert.notEqual(wrapperStart, -1, "host-safe wrapper should be present");
  assert.notEqual(wrapperEnd, -1, "host-safe wrapper should end before updateFabStatus");

  const directCalls = [...indexSource.matchAll(/updateMessageBlock\(/g)]
    .map((match) => match.index)
    .filter((index) => index < wrapperStart || index >= wrapperEnd);

  assert.deepEqual(directCalls, [], "direct updateMessageBlock calls should stay inside updateMessageBlockWhenReady");
});

test("message action buttons listen to SillyTavern render events", () => {
  const bootStart = indexSource.indexOf("eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived)");
  const bootEnd = indexSource.indexOf("eventSource.on(event_types.CHAT_CHANGED", bootStart);
  assert.notEqual(bootStart, -1, "boot event binding should be present");
  assert.notEqual(bootEnd, -1, "boot event binding should have a stable end marker");

  const boot = indexSource.slice(bootStart, bootEnd);
  assert.match(boot, /CHARACTER_MESSAGE_RENDERED/);
  assert.match(boot, /USER_MESSAGE_RENDERED/);
  assert.doesNotMatch(boot, /event_types\.MESSAGE_RENDERED/);
});

test("message action buttons are injected for messages already on screen", () => {
  assert.match(indexSource, /function injectMessageActionsForVisibleMessages/);

  const helperStart = indexSource.indexOf("function injectMessageActionsForVisibleMessages");
  const helperEnd = indexSource.indexOf("\n/**\n * 消息渲染时注入生图按钮", helperStart);
  assert.notEqual(helperStart, -1, "visible-message injector should be present");
  assert.notEqual(helperEnd, -1, "visible-message injector should end before render handler");
  const helper = indexSource.slice(helperStart, helperEnd);
  assert.match(helper, /#chat \.mes\[mesid\]/);
  assert.match(helper, /onMessageRendered\(id\)/);

  const bootStart = indexSource.indexOf("eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived)");
  const bootEnd = indexSource.indexOf("eventSource.on(event_types.CHAT_CHANGED", bootStart);
  const boot = indexSource.slice(bootStart, bootEnd);
  assert.match(boot, /injectMessageActionsForVisibleMessages/);
  assert.match(boot, /CHAT_LOADED/);
  assert.match(boot, /setTimeout\(injectMessageActionsForVisibleMessages,\s*1500\)/);

  const chatChangedStart = indexSource.indexOf("eventSource.on(event_types.CHAT_CHANGED");
  const chatChangedEnd = indexSource.indexOf("\n        });", chatChangedStart);
  const chatChanged = indexSource.slice(chatChangedStart, chatChangedEnd);
  assert.match(chatChanged, /injectMessageActionsForVisibleMessages/);
});

test("settings migration recognizes older optimizer and safety defaults", () => {
  assert.match(indexSource, /固定六项 \+ 简短画图指令/);
  assert.match(indexSource, /内容安全审查专家/);
  assert.match(indexSource, /function normalizeSafetyTemplateSetting/);
  assert.match(indexSource, /normalizeOptimizeTemplateSetting\(settings\);\s*normalizeSafetyTemplateSetting\(settings\);/);
});

test("workbench preview uses bounded thumbnail layout", () => {
  assert.match(fullSettingsSource, /oair-workbench-preview-grid/);
  assert.match(styleSource, /oair-workbench-preview-grid[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(96px,\s*1fr\)\)/);
  assert.match(styleSource, /oair-preview-thumb[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(styleSource, /oair-preview-thumb\s+img[\s\S]*object-fit:\s*cover/);
  assert.match(indexSource, /oair-preview-thumb/);
  assert.doesNotMatch(indexSource, /#oair_manual_preview img"\)\.each[\s\S]*previewImgs\.push\(src\);[\s\S]*renderManualPreview[\s\S]*css\(\{\s*width:\s*"100%"/);
});

test("workbench progress and errors are scroll contained", () => {
  assert.match(styleSource, /oair-progress-list[\s\S]*max-height:/);
  assert.match(styleSource, /oair-progress-list[\s\S]*overflow-y:\s*auto/);
  assert.match(styleSource, /oair-progress-status[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(styleSource, /oair-error-summary[\s\S]*max-height:/);
  assert.match(styleSource, /oair-error-summary[\s\S]*overflow-y:\s*auto/);
  assert.match(indexSource, /oair-error-summary/);
});

test("floating panel refits to viewport on window resize", () => {
  assert.match(indexSource, /function fitFloatingPanelToViewport/);
  assert.match(indexSource, /function bindFloatingViewportFit/);

  const fitStart = indexSource.indexOf("function fitFloatingPanelToViewport");
  const fitEnd = indexSource.indexOf("\nfunction clampFloatingPanelToViewport", fitStart);
  assert.notEqual(fitStart, -1, "floating viewport fit helper should be present");
  assert.notEqual(fitEnd, -1, "fit helper should sit before clamp helper");
  const fitHelper = indexSource.slice(fitStart, fitEnd);
  assert.match(fitHelper, /setProperty\("max-width"/);
  assert.match(fitHelper, /setProperty\("max-height"/);
  assert.match(fitHelper, /setProperty\("min-width"/);
  assert.match(fitHelper, /setProperty\("min-height"/);
  assert.match(fitHelper, /clampFloatingPanelToViewport\(panel\)/);

  const bindStart = indexSource.indexOf("function bindFloatingViewportFit");
  const bindEnd = indexSource.indexOf("\nasync function createFloatingPanel", bindStart);
  assert.notEqual(bindStart, -1, "resize binding helper should be present");
  assert.notEqual(bindEnd, -1, "resize binding helper should precede createFloatingPanel");
  const bindHelper = indexSource.slice(bindStart, bindEnd);
  assert.match(bindHelper, /\$\(window\)\.off\("resize\.oair_floating orientationchange\.oair_floating"\)/);
  assert.match(bindHelper, /\$\(window\)\.on\("resize\.oair_floating orientationchange\.oair_floating"/);
  assert.match(bindHelper, /fitFloatingPanelToViewport\(panel\)/);

  const closeStart = indexSource.indexOf("function closeFloatingPanel");
  const closeEnd = indexSource.indexOf("\nfunction toggleFloatingPanel", closeStart);
  assert.notEqual(closeStart, -1, "closeFloatingPanel should be present");
  assert.notEqual(closeEnd, -1, "closeFloatingPanel should have a stable end marker");
  const closeHelper = indexSource.slice(closeStart, closeEnd);
  assert.match(closeHelper, /\$\(window\)\.off\("resize\.oair_floating orientationchange\.oair_floating"\)/);

  assert.match(indexSource, /bindFloatingViewportFit\(panel\)/);
});

test("visible floating panel refreshes when the active character-card visual scope changes", () => {
  assert.match(indexSource, /let lastRenderedVisualScopeKey/);
  assert.match(indexSource, /let floatingVisualScopeRefreshTimer/);
  assert.match(indexSource, /function refreshFloatingUiIfVisualScopeChanged/);
  assert.match(indexSource, /function startFloatingVisualScopeWatch/);
  assert.match(indexSource, /function stopFloatingVisualScopeWatch/);

  const refreshStart = indexSource.indexOf("function refreshFloatingUiIfVisualScopeChanged");
  const refreshEnd = indexSource.indexOf("\nfunction startFloatingVisualScopeWatch", refreshStart);
  assert.notEqual(refreshStart, -1, "scope-change refresh helper should be present");
  assert.notEqual(refreshEnd, -1, "scope-change refresh helper should precede watcher start");
  const refreshHelper = indexSource.slice(refreshStart, refreshEnd);
  assert.match(refreshHelper, /createChatVisualScopeKey\(getCurrentChatVisualContext\(\)\)/);
  assert.match(refreshHelper, /lastRenderedVisualScopeKey/);
  assert.match(refreshHelper, /updateFloatingUi\(\)/);
  assert.match(refreshHelper, /refreshWorkbenchCharacterCandidates\(\)/);

  const watcherStart = indexSource.indexOf("function startFloatingVisualScopeWatch");
  const watcherEnd = indexSource.indexOf("\nfunction stopFloatingVisualScopeWatch", watcherStart);
  assert.notEqual(watcherStart, -1, "scope watcher start helper should be present");
  assert.notEqual(watcherEnd, -1, "scope watcher start helper should precede watcher stop");
  const watcherHelper = indexSource.slice(watcherStart, watcherEnd);
  assert.match(watcherHelper, /window\.setInterval/);
  assert.match(watcherHelper, /refreshFloatingUiIfVisualScopeChanged\(\)/);

  const updateStart = indexSource.indexOf("function updateFloatingUi");
  const updateEnd = indexSource.indexOf("\n// ═", updateStart);
  assert.notEqual(updateStart, -1, "floating UI updater should be present");
  assert.notEqual(updateEnd, -1, "floating UI updater should have a stable end marker");
  const updateHelper = indexSource.slice(updateStart, updateEnd);
  assert.match(updateHelper, /lastRenderedVisualScopeKey\s*=\s*createChatVisualScopeKey\(getCurrentChatVisualContext\(\)\)/);

  const closeStart = indexSource.indexOf("function closeFloatingPanel");
  const closeEnd = indexSource.indexOf("\nfunction toggleFloatingPanel", closeStart);
  assert.notEqual(closeStart, -1, "closeFloatingPanel should be present");
  assert.notEqual(closeEnd, -1, "closeFloatingPanel should have a stable end marker");
  const closeHelper = indexSource.slice(closeStart, closeEnd);
  assert.match(closeHelper, /stopFloatingVisualScopeWatch\(\)/);

  const toggleStart = indexSource.indexOf("function toggleFloatingPanel");
  const toggleEnd = indexSource.indexOf("\n// ─── L2: Floating Panel Event Binding", toggleStart);
  assert.notEqual(toggleStart, -1, "toggleFloatingPanel should be present");
  assert.notEqual(toggleEnd, -1, "toggleFloatingPanel should have a stable end marker");
  const toggleHelper = indexSource.slice(toggleStart, toggleEnd);
  assert.match(toggleHelper, /startFloatingVisualScopeWatch\(/);
});

test("automatic whole-message flow resolves the current target before attaching", () => {
  const handlerStart = indexSource.indexOf("async function handleAutomaticWholeMessage");
  const handlerEnd = indexSource.indexOf("\nfunction decodeHtmlAttribute", handlerStart);
  assert.notEqual(handlerStart, -1, "automatic whole-message handler should be present");
  assert.notEqual(handlerEnd, -1, "automatic whole-message handler should have a stable end marker");

  const handler = indexSource.slice(handlerStart, handlerEnd);
  assert.match(indexSource, /function resolveAutomaticAttachmentTarget/);
  assert.match(handler, /resolveAutomaticAttachmentTarget\(/);
  assert.doesNotMatch(handler, /getContext\(\)\?\.chatId\s*!==\s*chatId/);
  assert.doesNotMatch(handler, /context\.chat\?\.\[messageId\]\s*!==\s*message/);
});

test("automatic attachment can recover the current source message id", () => {
  const resolverStart = indexSource.indexOf("function resolveAutomaticAttachmentTarget");
  const resolverEnd = indexSource.indexOf("\nfunction getAutomaticQueueState", resolverStart);
  const handlerStart = indexSource.indexOf("async function handleAutomaticWholeMessage");
  const handlerEnd = indexSource.indexOf("\nfunction decodeHtmlAttribute", handlerStart);
  assert.notEqual(resolverStart, -1, "automatic target resolver should be present");
  assert.notEqual(resolverEnd, -1, "automatic target resolver should have a stable end marker");
  assert.notEqual(handlerStart, -1, "automatic whole-message handler should be present");
  assert.notEqual(handlerEnd, -1, "automatic whole-message handler should have a stable end marker");

  const resolver = indexSource.slice(resolverStart, resolverEnd);
  const handler = indexSource.slice(handlerStart, handlerEnd);
  assert.match(indexSource, /function findAutomaticAttachmentMessage/);
  assert.match(resolver, /findAutomaticAttachmentMessage\(/);
  assert.match(resolver, /messageId:/);
  assert.match(handler, /updateMessageBlockWhenReady\(target\.messageId,\s*targetMessage/);
  assert.doesNotMatch(handler, /updateMessageBlockWhenReady\(messageId,\s*targetMessage/);
});

test("automatic attachment never rerenders message text while attaching images", () => {
  const handlerStart = indexSource.indexOf("async function handleAutomaticWholeMessage");
  const handlerEnd = indexSource.indexOf("\nfunction decodeHtmlAttribute", handlerStart);
  assert.notEqual(handlerStart, -1, "automatic whole-message handler should be present");
  assert.notEqual(handlerEnd, -1, "automatic whole-message handler should have a stable end marker");

  const handler = indexSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /const hasLegacyPicTags = \/<pic\\b\[\^>\]\*>\/i\.test\(originalMessageText\)/);
  assert.match(handler, /stripRenderedPicTagsFromMessageBlock\(target\.messageId\)/);
  assert.match(handler, /updateMessageBlockWhenReady\(target\.messageId,\s*targetMessage,\s*\{\s*rerenderMessage:\s*false\s*\}\)/);
  assert.doesNotMatch(handler, /updateMessageBlockWhenReady\(target\.messageId,\s*targetMessage\);/);
});

test("image attachment initializes media array for freshly received messages", () => {
  const attachStart = indexSource.indexOf("function attachGeneratedImages");
  const attachEnd = indexSource.indexOf("\nfunction createDialogueAttachmentMetadata", attachStart);
  assert.notEqual(attachStart, -1, "attachment helper should be present");
  assert.notEqual(attachEnd, -1, "attachment helper should have a stable end marker");

  const helper = indexSource.slice(attachStart, attachEnd);
  assert.match(helper, /if\s*\(!Array\.isArray\(extra\.media\)\)\s*extra\.media\s*=\s*\[\]/);
  assert.match(helper, /extra\.media\.push/);
  assert.doesNotMatch(helper, /const usesMediaArray[\s\S]*if\s*\(usesMediaArray\)/);
});

test("manual workbench keeps policy safe retry as a visible action", () => {
  const executorStart = indexSource.indexOf("async function executeImagePlan");
  const executorEnd = indexSource.indexOf("\nfunction markImageJobFailure", executorStart);
  assert.notEqual(executorStart, -1, "image plan executor should be present");
  assert.notEqual(executorEnd, -1, "image plan executor should have a stable end marker");

  const executor = indexSource.slice(executorStart, executorEnd);
  assert.match(executor, /const autoPolicyRetry = meta\.policyAutoRetry !== false/);
  assert.match(executor, /if\s*\(autoPolicyRetry && canUsePolicySafeRetry\(job\)\)/);

  const manualStart = indexSource.indexOf("async function manualGenerate");
  const manualEnd = indexSource.indexOf("\nasync function manualOptimize", manualStart);
  assert.notEqual(manualStart, -1, "manual workbench handler should be present");
  assert.notEqual(manualEnd, -1, "manual workbench handler should have a stable end marker");

  const manual = indexSource.slice(manualStart, manualEnd);
  assert.match(manual, /source: "manual-comic", policyAutoRetry: false/);
  assert.match(manual, /source: "manual", policyAutoRetry: false/);
});

test("single-job safe retry result can render from job result images", () => {
  const previewStart = indexSource.indexOf("function renderManualPreview");
  const previewEnd = indexSource.indexOf("\nfunction openImageLightbox", previewStart);
  assert.notEqual(previewStart, -1, "manual preview renderer should be present");
  assert.notEqual(previewEnd, -1, "manual preview renderer should have a stable end marker");

  const preview = indexSource.slice(previewStart, previewEnd);
  assert.match(preview, /const directImages = Array\.isArray\(images\) \? images : \[\]/);
  assert.match(preview, /!\s*directImages\.length\s*&&\s*Array\.isArray\(job\.result\?\.images\)/);
  assert.match(preview, /job\.result\.images\.length > 0/);
});

test("lightbox controls stay anchored inside a viewport-sized overlay", () => {
  const lightboxStart = indexSource.indexOf("function openImageLightbox");
  const lightboxEnd = indexSource.indexOf("\n// ═══════════════════════════════════════════════════════════════", lightboxStart);
  assert.notEqual(lightboxStart, -1, "lightbox helper should be present");
  assert.notEqual(lightboxEnd, -1, "lightbox helper should end before the next section");

  const lightbox = indexSource.slice(lightboxStart, lightboxEnd);
  assert.match(lightbox, /width:\s*"100vw"/);
  assert.match(lightbox, /height:\s*"100vh"/);
  assert.match(lightbox, /minHeight:\s*"100dvh"/);
  assert.match(lightbox, /overflow:\s*"hidden"/);
  assert.match(lightbox, /const counter[\s\S]*position:\s*"absolute"[\s\S]*bottom:\s*"18px"/);
  assert.match(lightbox, /const navButton[\s\S]*position:\s*"absolute"[\s\S]*top:\s*"50%"/);
  assert.match(lightbox, /\.attr\("title",[\s\S]*position:\s*"absolute"[\s\S]*top:\s*"16px"/);

  const fixedPositions = [...lightbox.matchAll(/position:\s*"fixed"/g)];
  assert.equal(fixedPositions.length, 1, "only the overlay should use fixed positioning");
});

test("current chat visual context forwards user persona fields", () => {
  assert.match(indexSource, /name1,/);

  const contextStart = indexSource.indexOf("function getCurrentChatVisualContext");
  const contextEnd = indexSource.indexOf("\nfunction getChatVisualStore", contextStart);
  assert.notEqual(contextStart, -1, "visual context helper should be present");
  assert.notEqual(contextEnd, -1, "visual context helper should have a stable end marker");

  const helper = indexSource.slice(contextStart, contextEnd);
  assert.match(helper, /getCurrentChatId/);
  assert.match(helper, /runtimeChatId/);
  assert.match(helper, /chatMetadata,/);
  assert.match(helper, /userName:/);
  assert.match(helper, /personaName:/);
  assert.match(helper, /personaAppearance:/);
  assert.match(helper, /personaDescription:/);
});

test("current visual context exposes character-card identity for card-scoped libraries", () => {
  const contextStart = indexSource.indexOf("function getCurrentChatVisualContext");
  const contextEnd = indexSource.indexOf("\nfunction getChatVisualStore", contextStart);
  assert.notEqual(contextStart, -1, "visual context helper should be present");
  assert.notEqual(contextEnd, -1, "visual context helper should have a stable end marker");

  const helper = indexSource.slice(contextStart, contextEnd);
  assert.match(helper, /characterId:/);
  assert.match(helper, /characterName:/);
  assert.match(helper, /characterAvatar:/);
  assert.match(helper, /characterCardKey:/);
});

test("visual library rows can be selected by clicking the whole row", () => {
  const modalStart = indexSource.indexOf("function openLibraryModal");
  const modalEnd = indexSource.indexOf("\nasync function extractLibraryFromChat", modalStart);
  assert.notEqual(modalStart, -1, "library modal should be present");
  assert.notEqual(modalEnd, -1, "library modal should have a stable end marker");

  const modal = indexSource.slice(modalStart, modalEnd);
  assert.match(modal, /addClass\("oair-library-row"\)[\s\S]*\.attr\(\{\s*tabindex:\s*0,\s*role:\s*"button"/);
  assert.match(modal, /function selectLibraryRow\(index\)/);
  assert.match(modal, /row\.on\("click"/);
  assert.match(modal, /row\.on\("keydown"/);
  assert.match(modal, /e\.key === "Enter" \|\| e\.key === " "/);
  assert.match(styleSource, /oair-library-row[\s\S]*cursor:\s*pointer/);
  assert.match(fullSettingsSource, /oair-library-row[\s\S]*cursor:\s*pointer/);
});

test("history and gallery panes render paginated pages", () => {
  assert.match(indexSource, /const GALLERY_PAGE_SIZE = 12/);
  assert.match(indexSource, /const HISTORY_PAGE_SIZE = 10/);
  assert.match(indexSource, /function getPagedUiItems\(key, list, pageSize\)/);
  assert.match(indexSource, /function appendPaginationControls\(container, key, total, pageSize, rerender\)/);
  assert.match(indexSource, /getPagedUiItems\("gallery", list, GALLERY_PAGE_SIZE\)/);
  assert.match(indexSource, /getPagedUiItems\("generation", list, HISTORY_PAGE_SIZE\)/);
  assert.match(indexSource, /getPagedUiItems\("failed", failed, HISTORY_PAGE_SIZE\)/);
  assert.match(indexSource, /getPagedUiItems\("retry", retryable, HISTORY_PAGE_SIZE\)/);
  assert.doesNotMatch(indexSource, /list\.slice\(0,\s*30\)/);
  assert.doesNotMatch(indexSource, /failed\.slice\(0,\s*20\)/);
  assert.doesNotMatch(indexSource, /retryable\.slice\(0,\s*20\)/);
  assert.match(styleSource, /oair-pagination/);
  assert.match(fullSettingsSource, /oair-pagination/);
});

test("generation workbench omits persistent character confirmation and storyboard plan sections", () => {
  const workbenchStart = fullSettingsSource.indexOf('id="oair_panel_workbench"');
  const libraryStart = fullSettingsSource.indexOf('id="oair_panel_library"', workbenchStart);
  assert.notEqual(workbenchStart, -1, "workbench panel should exist");
  assert.notEqual(libraryStart, -1, "library panel should follow workbench");

  const workbench = fullSettingsSource.slice(workbenchStart, libraryStart);
  assert.doesNotMatch(workbench, /人物确认/);
  assert.doesNotMatch(workbench, /分镜计划/);
  assert.doesNotMatch(workbench, /oair_character_confirmation/);
  assert.match(workbench, /oair_automatic_flow_enabled/);
  assert.match(workbench, /自动整条 AI 消息生图/);
});

test("library clear keeps clearing associated card state even when library rows are empty", () => {
  const clearStart = indexSource.indexOf("function clearLibrary");
  const clearEnd = indexSource.indexOf("\nfunction openLibraryModal", clearStart);
  assert.notEqual(clearStart, -1, "clearLibrary should be present");
  assert.notEqual(clearEnd, -1, "clearLibrary should have a stable end marker");

  const clearLibrary = indexSource.slice(clearStart, clearEnd);
  assert.match(clearLibrary, /hasAssociatedState/);
  assert.match(clearLibrary, /if \(!count && !hasAssociatedState\)/);
  assert.match(clearLibrary, /patch\.confirmedCharacters = \[\]/);
  assert.match(clearLibrary, /patch\[cfg\.activeKey\] = ""/);
});

test("library edits refresh the visible visual-scope status", () => {
  assert.match(indexSource, /function updateVisualScopeStatus/);

  const statusStart = indexSource.indexOf("function updateVisualScopeStatus");
  const statusEnd = indexSource.indexOf("\n// ─── Library UI helpers", statusStart);
  assert.notEqual(statusStart, -1, "visual scope status helper should be present");
  assert.notEqual(statusEnd, -1, "visual scope status helper should end before library helpers");
  const statusHelper = indexSource.slice(statusStart, statusEnd);
  assert.match(statusHelper, /#oair_visual_scope_status/);
  assert.match(statusHelper, /getVisualScopeLabel\(\)/);

  const commitStart = indexSource.indexOf("function commitLibrary");
  const commitEnd = indexSource.indexOf("\nfunction updateLibraryHiddenFields", commitStart);
  assert.notEqual(commitStart, -1, "commitLibrary should be present");
  assert.notEqual(commitEnd, -1, "commitLibrary should have a stable end marker");
  const commitLibrary = indexSource.slice(commitStart, commitEnd);
  assert.match(commitLibrary, /updateVisualScopeStatus\(\)/);
});

test("generation paths resolve the active character-card Visual Bible through fixed settings", () => {
  const fixedStart = indexSource.indexOf("async function resolveFixedSettings");
  const fixedEnd = indexSource.indexOf("\nfunction loadGallery", fixedStart);
  assert.notEqual(fixedStart, -1, "fixed settings resolver should exist");
  assert.notEqual(fixedEnd, -1, "fixed settings resolver should have a stable end marker");
  const fixedResolver = indexSource.slice(fixedStart, fixedEnd);
  assert.match(fixedResolver, /resolveCurrentChatVisualBible\(base,\s*settings\)/);
  assert.match(fixedResolver, /visualBible\.values/);

  for (const name of [
    "async function requestSingleImagePlan",
    "async function requestMultiImagePlan",
    "async function requestComicImagePlan",
    "async function generateFromMessage",
    "async function summarizeAndGenerate",
    "async function onMessageReceived",
    "async function handleAutomaticWholeMessage",
  ]) {
    assert.notEqual(indexSource.indexOf(name), -1, `${name} should be present`);
  }
});

test("built-in style preset and automatic extraction controls are present in the library UI", () => {
  assert.match(fullSettingsSource, /oair_builtin_style_presets/);
  assert.match(fullSettingsSource, /oair_btn_import_builtin_styles/);
  assert.match(fullSettingsSource, /oair_auto_extract_characters/);
  assert.match(fullSettingsSource, /oair_auto_extract_scenes/);
  assert.match(fullSettingsSource, /current character card|当前角色卡/);

  assert.match(indexSource, /BUILT_IN_STYLE_PRESETS/);
  assert.match(indexSource, /#oair_btn_import_builtin_styles/);
  assert.match(indexSource, /#oair_auto_extract_characters/);
  assert.match(indexSource, /#oair_auto_extract_scenes/);
  assert.match(styleSource, /oair-built-in-style/);
});

test("automatic whole-message workflow records visible lifecycle status events", () => {
  assert.match(indexSource, /function recordAutomaticFlowEvent/);
  assert.match(indexSource, /#oair_automatic_flow_events/);

  const handlerStart = indexSource.indexOf("async function handleAutomaticWholeMessage");
  const handlerEnd = indexSource.indexOf("\nfunction decodeHtmlAttribute", handlerStart);
  assert.notEqual(handlerStart, -1, "automatic whole-message handler should be present");
  assert.notEqual(handlerEnd, -1, "automatic whole-message handler should have a stable end marker");
  const handler = indexSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /recordAutomaticFlowEvent\([^)]*queued|recordAutomaticFlowEvent\([^)]*start|recordAutomaticFlowEvent\([^)]*running/s);
  assert.match(handler, /recordAutomaticFlowEvent\([^)]*skip/s);
  assert.match(handler, /recordAutomaticFlowEvent\([^)]*success/s);
  assert.match(handler, /recordAutomaticFlowEvent\([^)]*failure/s);
  assert.match(indexSource, /policy-retry|safety-rewrite/);
});

test("automatic extraction is wired into new AI message handling without manual generation dependency", () => {
  assert.match(indexSource, /function maybeAutoExtractVisualLibraries/);
  assert.match(indexSource, /applyAutomaticVisualExtraction/);

  const messageStart = indexSource.indexOf("async function onMessageReceived");
  const messageEnd = indexSource.indexOf("\nasync function generateFromMessage", messageStart);
  assert.notEqual(messageStart, -1, "message receive handler should be present");
  assert.notEqual(messageEnd, -1, "message receive handler should have a stable end marker");
  const messageHandler = indexSource.slice(messageStart, messageEnd);
  assert.match(messageHandler, /maybeAutoExtractVisualLibraries\(/);
});

test("README explains compile, optional refinement, safety rewrite, and final prompt priority", () => {
  assert.match(readmeSource, /compileImagePrompt|prompt_compiler\.mjs/);
  assert.match(readmeSource, /local compile|本地编译|本地 prompt compiler/i);
  assert.match(readmeSource, /optimizeEnabled/);
  assert.match(readmeSource, /optimizeAuto/);
  assert.match(readmeSource, /optional|可选/);
  assert.match(readmeSource, /safety rewrite|安全重写|policy retry/i);
  assert.match(readmeSource, /final image backend prompt|最终.*图片后端|最终.*生图后端/i);
  assert.match(readmeSource, /autoExtractCharactersEnabled/);
  assert.match(readmeSource, /autoExtractScenesEnabled/);
  assert.match(readmeSource, /built-in style|内置风格/);
});
