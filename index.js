// ═══════════════════════════════════════════════════════════════
// ST-OpenAI-Image-Relay — Enhanced Version (Plan C: Hybrid UI)
// SillyTavern 第三方扩展：AI 图片生成中继
// ═══════════════════════════════════════════════════════════════

import { extension_settings, getContext } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    updateMessageBlock,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from "../../../../script.js";
import { regexFromString } from "../../../utils.js";

// ═══════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

const extensionName = "ST-OpenAI-Image-Relay";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const mainPromptKey = `${extensionName}-MAIN-PROMPT`;
const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+)\)/g;
const looseImageUrlRegex = /((?:https?:\/\/|\/)[^\s)"']+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s)"']*)?)/gi;
const inFlightMessages = new Set();

// ═══════════════════════════════════════════════════════════════
// SECTION 2: DEFAULT SETTINGS & TEMPLATES
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MAIN_PROMPT = [
    '在正常生成回复正文时，可以同时为当前这一次回复补充一条用于 image2 的绘图提示词，并将它放在正文末尾，格式必须为：',
    '',
    '<pic prompt="这里填写提示词">',
    '',
    '生成这条提示词时，必须严格遵守以下规则：',
    '',
    '1. 每次回复至多只能输出一条 `<pic prompt="...">`，不要输出多个，不要提供备选。',
    '2. `<pic prompt="...">` 里的内容必须始终是纯 SFW 的安全画面，不允许出现色情、裸露、性暗示、露骨身体描写、性行为、血腥重伤等内容。即使正文内容本身带有 NSFW 倾向，这条提示词也必须自动转化为安全、纯净、自然的 SFW 画面。',
    '3. 提示词内容必须使用中文连贯句子书写，而不是关键词堆砌。应充分利用强大的世界理解能力和文字生成能力，把画面描述成完整、自然、可直接用于生成单张图片的中文句子。',
    '4. 提示词应尽量与本次正文内容、场景、角色状态、环境氛围保持一致，但画面必须优先安全，可改写为人物立绘、日常场景、背景环境、建筑、街景、室内、道具展示、风景等适合 SFW 呈现的内容。',
    '5. 提示词中可以明确描述人物外观、服装、动作、表情、镜头、构图、光线、时间、天气、背景细节、环境气氛，也可以直接写出画面里应出现的中文文字内容、位置、样式或招牌文字。',
    '6. 提示词只服务于生成一张图片，因此内容必须统一、集中、明确，避免拆分成多幅画面，避免"第一张/第二张/"等表达。',
    '7. 除正文和这一条 `<pic prompt="...">` 外，不要输出任何额外说明，不要解释这条提示词的生成过程。',
    '',
    '如果当前回复内容明显不适合配图，或者没有合适的安全画面可提炼，则不要输出 `<pic prompt="...">`。',
].join('\n');

const DEFAULT_OPTIMIZE_TEMPLATE = [
    '你是一个专业的图片提示词优化专家。请将用户提供的简单描述优化为更详细、更有画面感的图片生成提示词。',
    '',
    '优化要求：',
    '1. 补充画面细节：光线、构图、色彩、氛围、视角、人物表情和动作等',
    '2. 使用更具描述性和视觉化的语言',
    '3. 保持原始描述的核心意图不变',
    '4. 输出纯优化后的提示词，不要包含任何解释、前言或后记',
    '5. 使用中文连贯句子描述，而不是关键词堆砌',
    '',
    '原始描述：',
    '{{prompt}}',
].join('\n');

const DEFAULT_NSFW_TEMPLATE = [
    '你是一个内容安全审查专家。请审查并修改以下图片生成提示词，确保其内容安全（SFW）。',
    '',
    '规则：',
    '1. 移除任何色情、裸露、性暗示、露骨身体描写、性行为的内容',
    '2. 移除任何血腥、暴力、重度伤害的描述',
    '3. 将不安全的内容替换为安全、自然、健康的替代描述（如改为人物立绘、日常场景、风景等）',
    '4. 保持提示词的整体画面意图和构图方向',
    '5. 如果原始提示词完全是安全的，直接原样返回不做修改',
    '6. 只输出修改后的提示词，不要包含任何解释',
    '',
    '原始提示词：',
    '{{prompt}}',
].join('\n');

const DEFAULT_SUMMARIZE_TEMPLATE = [
    '请将以下聊天消息内容转换为一张图片的生成提示词。',
    '',
    '要求：',
    '1. 提取消息中最有画面感的场景、角色动作或环境描写',
    '2. 将其转化为完整的图片描述，包含构图、光线、氛围等细节',
    '3. 确保内容安全（SFW），避免色情或暴力内容',
    '4. 使用中文连贯句子描述，而不是关键词堆砌',
    '5. 只输出提示词，不要包含解释',
    '',
    '消息内容：',
    '{{message}}',
].join('\n');

const defaultSettings = {
    // ─── 基础 ──────────────────────────────────────────────
    enabled: true,
    mainPrompt: DEFAULT_MAIN_PROMPT,

    // ─── 后端 ──────────────────────────────────────────────
    apiMode: "chat",                            // "chat" | "images"
    serviceUrl: "http://127.0.0.1:8199/v1",
    apiKey: "sk-any",
    model: "any",
    timeoutMs: 120000,
    promptTemplate: "请根据以下提示词生成图片，并且只返回最终图片。\n\n{{prompt}}",
    imagesPromptTemplate: "{{prompt}}",         // images API 模板（默认直通）
    imageSize: "1024x1024",
    imageCount: 1,
    imageResponseFormat: "url",                 // "url" | "b64_json"
    extraBody: "",

    // ─── 提取 ──────────────────────────────────────────────
    extractionRegex: '/<pic[^>]*\\sprompt="([^"]+)"[^>]*>/g',
    responseImageRegex: "/!\\[[^\\]]*\\]\\(([^)\\s]+)\\)/g",

    // ─── 优化 ──────────────────────────────────────────────
    optimizeEnabled: false,
    optimizeAuto: false,
    optimizeTemplate: DEFAULT_OPTIMIZE_TEMPLATE,
    optimizeApiUrl: "",
    optimizeModel: "",
    optimizeApiKey: "",

    // ─── NSFW 规避 ──────────────────────────────────────────
    nsfwAvoidance: false,
    nsfwAvoidanceTemplate: DEFAULT_NSFW_TEMPLATE,

    // ─── 消息生图 ──────────────────────────────────────────
    messageGenEnabled: true,
    summarizeTemplate: DEFAULT_SUMMARIZE_TEMPLATE,

    // ─── UI 控制 ──────────────────────────────────────────
    fabEnabled: false,
    fabPosition: { top: null, left: null },
    floatingDefaultTab: "manual",
};

// ═══════════════════════════════════════════════════════════════
// SECTION 3: INITIALIZATION & EVENT WIRING
// ═══════════════════════════════════════════════════════════════

$(function () {
    (async function () {
        ensureSettings();
        applyMainPromptInjection();
        loadStylesheet();

        // Poll for #extensions_settings and inject the minimal panel
        setInterval(() => {
            if ($("#oair_ui_drawer").length > 0) {
                return;
            }

            const container = $("#extensions_settings");
            if (container.length > 0) {
                injectPanelUi(container);
            }
        }, 1000);

        // If FAB is enabled, create it on startup
        if (extension_settings[extensionName].fabEnabled) {
            createFab();
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.MESSAGE_RENDERED, onMessageRendered);
    })();
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: UI — INJECTION, FAB, FLOATING PANEL & BINDING
// ═══════════════════════════════════════════════════════════════

// ─── Stylesheet ──────────────────────────────────────────────

function loadStylesheet() {
    if ($("#oair_stylesheet").length) return;
    $("<link>")
        .attr("id", "oair_stylesheet")
        .attr("rel", "stylesheet")
        .attr("href", `${extensionFolderPath}/style.css`)
        .appendTo("head");
}

// ─── L0: Minimal Panel Injection ─────────────────────────────

async function injectPanelUi(container) {
    let htmlContent = "";

    try {
        htmlContent = await $.get(`${extensionFolderPath}/settings_panel.html`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load settings_panel.html`, error);
        return;
    }

    const drawerHtml = `
    <div id="oair_ui_drawer" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🖼️ 图片中继</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display:none;">${htmlContent}</div>
    </div>`;

    container.prepend(drawerHtml);
    bindPanelEvents();
    updatePanelUi();
    setStatus("就绪");
}

// ─── L0: Panel Event Binding ─────────────────────────────────

function bindPanelEvents() {
    // Drawer toggle
    $("#oair_ui_drawer .inline-drawer-toggle").off("click").on("click", function (event) {
        event.stopPropagation();
        event.preventDefault();
        $(this).parent().find(".inline-drawer-content").slideToggle(200);
        $(this).find(".inline-drawer-icon").toggleClass("down up");
    });

    $("#oair_ui_drawer .inline-drawer-content").off("click").on("click", (event) => event.stopPropagation());

    // Enabled toggle
    bindSettingInput("#oair_enabled", "enabled", () => {
        const val = $("#oair_enabled").prop("checked");
        // Sync floating panel's enabled checkbox if open
        $("#oair_floating_enabled").prop("checked", val);
        return val;
    });

    // FAB enabled toggle
    bindSettingInput("#oair_fab_enabled", "fabEnabled", () => {
        const val = $("#oair_fab_enabled").prop("checked");
        if (val) {
            createFab();
        } else {
            removeFab();
        }
        return val;
    });

    // Open floating config button
    $("#oair_btn_open_floating").off("click").on("click", (e) => {
        e.preventDefault();
        toggleFloatingPanel();
    });
}

// ─── L1: FAB (Floating Action Button) ────────────────────────

function createFab() {
    if ($("#oair_fab").length) return;

    const s = extension_settings[extensionName];
    const fab = $("<div id='oair_fab'><i class='fa-solid fa-image'></i></div>");

    // Position: from saved settings or default (right: 20px, bottom: 80px)
    if (s.fabPosition && s.fabPosition.top != null && s.fabPosition.left != null) {
        fab.css({ top: s.fabPosition.top, left: s.fabPosition.left });
    } else {
        fab.css({ right: "20px", bottom: "80px" });
    }

    fab.appendTo("body");
    fab.addClass("oair-fab--visible");

    // Unified click/drag/longpress handling
    let clickTimer = null;
    let isDragging = false;
    let dragStarted = false;
    let startX, startY, origLeft, origTop;
    let touchHandled = false; // prevent mousedown after touch

    // Helper: handle pointer down
    function handleDown(clientX, clientY) {
        isDragging = false;
        dragStarted = false;
        startX = clientX;
        startY = clientY;
        origLeft = fab.offset().left;
        origTop = fab.offset().top;

        // Long-press timer (1 second → hide FAB)
        clickTimer = setTimeout(() => {
            if (!dragStarted) {
                extension_settings[extensionName].fabEnabled = false;
                extension_settings[extensionName].fabPosition = { top: null, left: null };
                saveSettingsDebounced();
                updatePanelUi();
                removeFab();
                toastr.info("悬浮按钮已隐藏，可在面板中重新启用。");
            }
        }, 1000);
    }

    // Helper: handle pointer move
    function handleMove(clientX, clientY) {
        if (clickTimer === null) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const threshold = 8; // larger threshold for touch-friendly

        if (!dragStarted && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) {
            dragStarted = true;
            isDragging = true;
            clearTimeout(clickTimer);
            clickTimer = -1;
        }

        if (isDragging) {
            fab.css({
                left: origLeft + dx,
                top: origTop + dy,
                right: "auto",
                bottom: "auto",
            });
        }
    }

    // Helper: handle pointer up
    function handleUp() {
        if (clickTimer === null) return;
        if (clickTimer !== -1) {
            clearTimeout(clickTimer);
        }
        clickTimer = null;

        if (!isDragging) {
            toggleFloatingPanel();
        } else {
            const pos = fab.offset();
            extension_settings[extensionName].fabPosition = {
                top: pos.top,
                left: pos.left,
            };
            saveSettingsDebounced();
        }

        isDragging = false;
        dragStarted = false;
    }

    // Mouse events (desktop)
    fab.on("mousedown", function (e) {
        if (touchHandled) { touchHandled = false; return; } // skip if touch already handled
        handleDown(e.clientX, e.clientY);
        e.preventDefault();
    });

    $(document).on("mousemove.oair_fab", function (e) {
        handleMove(e.clientX, e.clientY);
    });

    $(document).on("mouseup.oair_fab", function () {
        handleUp();
    });

    // Touch events (mobile) — these fire FIRST, then mousedown
    fab.on("touchstart", function (e) {
        touchHandled = true; // flag to skip the subsequent mousedown
        const touch = e.originalEvent.touches[0];
        handleDown(touch.clientX, touch.clientY);
        e.preventDefault(); // prevent ghost click, double-tap zoom, and scroll
    }, { passive: false });

    fab.on("touchmove", function (e) {
        if (clickTimer === null) return;
        const touch = e.originalEvent.touches[0];
        handleMove(touch.clientX, touch.clientY);
        if (isDragging) {
            e.preventDefault(); // only prevent scroll when actually dragging
        }
    }, { passive: false });

    fab.on("touchend", function (e) {
        e.preventDefault(); // prevent ghost click event
        handleUp();
        // Reset touchHandled after a small delay so next standalone mousedown works
        setTimeout(() => { touchHandled = false; }, 400);
    }, { passive: false });
}

function removeFab() {
    const fab = $("#oair_fab");
    if (fab.length) {
        $(document).off("mousemove.oair_fab mouseup.oair_fab");
        fab.remove();
    }
}

// ─── L2: Floating Panel ──────────────────────────────────────

function createFloatingPanel() {
    if ($("#oair_floating_panel").length) return;

    const panel = $(`
        <div id="oair_floating_panel">
            <div class="oair-floating-header">
                <h3>🖼️ 图片中继 - 详细配置</h3>
                <button class="oair-floating-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="oair-floating-body"></div>
        </div>
    `);

    // Default position: centered on screen
    panel.css({
        top: Math.max(40, (window.innerHeight - 500) / 2),
        left: Math.max(10, (window.innerWidth - 480) / 2),
    });

    panel.appendTo("body");

    // Load settings_full.html content into the body
    const body = panel.find(".oair-floating-body");
    $.get(`${extensionFolderPath}/settings_full.html`)
        .done((html) => {
            body.html(html);
            bindFloatingEvents();
            updateFloatingUi();

            // Set default tab
            const s = extension_settings[extensionName];
            const tabMap = {
                basic: "#oair_tab_basic",
                backend: "#oair_tab_backend",
                extract: "#oair_tab_extract",
                optimize: "#oair_tab_optimize",
                manual: "#oair_tab_manual",
            };
            const targetTab = tabMap[s.floatingDefaultTab] || tabMap.manual;
            $(targetTab).prop("checked", true);
        })
        .fail((error) => {
            console.error(`[${extensionName}] Failed to load settings_full.html`, error);
            body.html("<p style='color:#ff9090;'>加载配置界面失败</p>");
        });

    // Draggable via header
    let headerDragging = false;
    let headerStartX, headerStartY, panelOrigLeft, panelOrigTop;

    panel.find(".oair-floating-header").on("mousedown", function (e) {
        if ($(e.target).closest(".oair-floating-close").length) return;
        headerDragging = true;
        headerStartX = e.clientX;
        headerStartY = e.clientY;
        const pos = panel.offset();
        panelOrigLeft = pos.left;
        panelOrigTop = pos.top;
        e.preventDefault();
    });

    $(document).on("mousemove.oair_floating", function (e) {
        if (!headerDragging) return;
        panel.css({
            left: panelOrigLeft + (e.clientX - headerStartX),
            top: panelOrigTop + (e.clientY - headerStartY),
        });
    });

    $(document).on("mouseup.oair_floating", function () {
        headerDragging = false;
    });

    // Close button
    panel.find(".oair-floating-close").on("click", () => closeFloatingPanel());

    // ESC key to close
    $(document).on("keydown.oair_floating", function (e) {
        if (e.key === "Escape" && panel.hasClass("oair-floating--visible")) {
            closeFloatingPanel();
        }
    });
}

function closeFloatingPanel() {
    const panel = $("#oair_floating_panel");
    if (!panel.length) return;

    panel.removeClass("oair-floating--visible");

    // Clean up document-level event handlers
    $(document).off("mousemove.oair_floating mouseup.oair_floating keydown.oair_floating");

    // Sync panel UI when closing (in case enabled/fabEnabled changed in floating window)
    updatePanelUi();
}

function toggleFloatingPanel() {
    const panel = $("#oair_floating_panel");

    if (!panel.length) {
        // Create the panel lazily
        createFloatingPanel();
        // The panel will be shown after content loads — add visible class after a tick
        setTimeout(() => {
            $("#oair_floating_panel").addClass("oair-floating--visible");
        }, 50);
        return;
    }

    if (panel.hasClass("oair-floating--visible")) {
        closeFloatingPanel();
    } else {
        // Rebind document-level handlers
        let headerDragging = false;
        let headerStartX, headerStartY, panelOrigLeft, panelOrigTop;

        panel.find(".oair-floating-header").off("mousedown").on("mousedown", function (e) {
            if ($(e.target).closest(".oair-floating-close").length) return;
            headerDragging = true;
            headerStartX = e.clientX;
            headerStartY = e.clientY;
            const pos = panel.offset();
            panelOrigLeft = pos.left;
            panelOrigTop = pos.top;
            e.preventDefault();
        });

        $(document).off("mousemove.oair_floating mouseup.oair_floating keydown.oair_floating");

        $(document).on("mousemove.oair_floating", function (e) {
            if (!headerDragging) return;
            panel.css({
                left: panelOrigLeft + (e.clientX - headerStartX),
                top: panelOrigTop + (e.clientY - headerStartY),
            });
        });

        $(document).on("mouseup.oair_floating", function () {
            headerDragging = false;
        });

        $(document).on("keydown.oair_floating", function (e) {
            if (e.key === "Escape") {
                closeFloatingPanel();
            }
        });

        // Update UI in case settings changed while panel was closed
        updateFloatingUi();

        // Set default tab
        const s = extension_settings[extensionName];
        const tabMap = {
            basic: "#oair_tab_basic",
            backend: "#oair_tab_backend",
            extract: "#oair_tab_extract",
            optimize: "#oair_tab_optimize",
            manual: "#oair_tab_manual",
        };
        const targetTab = tabMap[s.floatingDefaultTab] || tabMap.manual;
        $(targetTab).prop("checked", true);

        panel.addClass("oair-floating--visible");
    }
}

// ─── L2: Floating Panel Event Binding ────────────────────────

function bindFloatingEvents() {
    const fp = $("#oair_floating_panel");

    // Close button (re-bind since content was just loaded)
    fp.find(".oair-floating-close").off("click").on("click", () => closeFloatingPanel());

    // ─── Floating status bar — enabled toggle ──────────────
    bindSettingInput("#oair_floating_enabled", "enabled", () => {
        const val = $("#oair_floating_enabled").prop("checked");
        // Sync panel checkbox
        $("#oair_enabled").prop("checked", val);
        return val;
    });

    // ─── 基础设置 ──────────────────────────────────────────
    bindSettingInput("#oair_main_prompt", "mainPrompt", () => fp.find("#oair_main_prompt").val());
    bindSettingInput("#oair_message_gen_enabled", "messageGenEnabled", () => fp.find("#oair_message_gen_enabled").prop("checked"));
    bindSettingInput("#oair_summarize_template", "summarizeTemplate", () => fp.find("#oair_summarize_template").val());

    // ─── 后端设置 ──────────────────────────────────────────
    bindSettingInput("#oair_api_mode", "apiMode", () => fp.find("#oair_api_mode").val());
    bindSettingInput("#oair_service_url", "serviceUrl", () => fp.find("#oair_service_url").val());
    bindSettingInput("#oair_api_key", "apiKey", () => fp.find("#oair_api_key").val());
    bindSettingInput("#oair_model", "model", () => fp.find("#oair_model").val());
    bindSettingInput("#oair_timeout_ms", "timeoutMs", () => Number(fp.find("#oair_timeout_ms").val()) || defaultSettings.timeoutMs);
    bindSettingInput("#oair_prompt_template", "promptTemplate", () => fp.find("#oair_prompt_template").val());
    bindSettingInput("#oair_images_prompt_template", "imagesPromptTemplate", () => fp.find("#oair_images_prompt_template").val());
    bindSettingInput("#oair_image_size", "imageSize", () => fp.find("#oair_image_size").val());
    bindSettingInput("#oair_image_count", "imageCount", () => Number(fp.find("#oair_image_count").val()) || 1);
    bindSettingInput("#oair_image_response_format", "imageResponseFormat", () => fp.find("#oair_image_response_format").val());
    bindSettingInput("#oair_extra_body", "extraBody", () => fp.find("#oair_extra_body").val());

    // API mode toggle: show/hide relevant fields (scoped to floating panel)
    fp.find("#oair_api_mode").off("change").on("change", function () {
        const isImagesMode = $(this).val() === "images";
        fp.find(".oair-images-api-fields").toggle(isImagesMode);
        fp.find(".oair-chat-api-fields").toggle(!isImagesMode);
        extension_settings[extensionName].apiMode = $(this).val();
        saveSettingsDebounced();
    });

    // ─── 提取设置 ──────────────────────────────────────────
    bindSettingInput("#oair_extraction_regex", "extractionRegex", () => fp.find("#oair_extraction_regex").val());
    bindSettingInput("#oair_response_image_regex", "responseImageRegex", () => fp.find("#oair_response_image_regex").val());

    // ─── 优化设置 ──────────────────────────────────────────
    bindSettingInput("#oair_optimize_enabled", "optimizeEnabled", () => fp.find("#oair_optimize_enabled").prop("checked"));
    bindSettingInput("#oair_optimize_auto", "optimizeAuto", () => fp.find("#oair_optimize_auto").prop("checked"));
    bindSettingInput("#oair_optimize_template", "optimizeTemplate", () => fp.find("#oair_optimize_template").val());
    bindSettingInput("#oair_optimize_api_url", "optimizeApiUrl", () => fp.find("#oair_optimize_api_url").val());
    bindSettingInput("#oair_optimize_model", "optimizeModel", () => fp.find("#oair_optimize_model").val());
    bindSettingInput("#oair_optimize_api_key", "optimizeApiKey", () => fp.find("#oair_optimize_api_key").val());

    // ─── NSFW 规避 ──────────────────────────────────────────
    bindSettingInput("#oair_nsfw_avoidance", "nsfwAvoidance", () => fp.find("#oair_nsfw_avoidance").prop("checked"));
    bindSettingInput("#oair_nsfw_avoidance_template", "nsfwAvoidanceTemplate", () => fp.find("#oair_nsfw_avoidance_template").val());

    // ─── 手动生图 ──────────────────────────────────────────
    fp.find("#oair_btn_manual_gen").off("click").on("click", (e) => { e.preventDefault(); manualGenerate(); });
    fp.find("#oair_btn_optimize").off("click").on("click", (e) => { e.preventDefault(); manualOptimize(); });
    fp.find("#oair_btn_clear_manual").off("click").on("click", (e) => {
        e.preventDefault();
        fp.find("#oair_manual_preview").empty();
        fp.find("#oair_manual_optimized_prompt").hide();
        fp.find("#oair_manual_optimized_text").text("");
        setStatus("预览已清空");
    });
}

// ─── Generic Setting Input Binder ────────────────────────────

function bindSettingInput(selector, key, getter) {
    // We bind on the selector directly; for floating panel fields,
    // the selectors are unique IDs within the floating panel HTML.
    $(selector).off("input.oair change.oair").on("input.oair change.oair", () => {
        extension_settings[extensionName][key] = getter();
        saveSettingsDebounced();
        applyMainPromptInjection();
    });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: UI — SETTINGS SYNC
// ═══════════════════════════════════════════════════════════════

/**
 * Update all UI surfaces — call after settings change
 */
function syncAllUi() {
    updatePanelUi();
    if ($("#oair_floating_panel").length && $("#oair_floating_panel").hasClass("oair-floating--visible")) {
        updateFloatingUi();
    }
}

/**
 * Update the minimal panel (L0)
 */
function updatePanelUi() {
    const s = extension_settings[extensionName];
    $("#oair_enabled").prop("checked", !!s.enabled);
    $("#oair_fab_enabled").prop("checked", !!s.fabEnabled);
}

/**
 * Update the floating window (L2) — all settings fields
 */
function updateFloatingUi() {
    const s = extension_settings[extensionName];
    const fp = $("#oair_floating_panel");
    if (!fp.length) return;

    // Status bar
    fp.find("#oair_floating_enabled").prop("checked", !!s.enabled);

    // 基础
    fp.find("#oair_main_prompt").val(s.mainPrompt || "");
    fp.find("#oair_message_gen_enabled").prop("checked", s.messageGenEnabled !== false);
    fp.find("#oair_summarize_template").val(s.summarizeTemplate || "");

    // 后端
    fp.find("#oair_api_mode").val(s.apiMode || "chat");
    fp.find("#oair_service_url").val(s.serviceUrl || "");
    fp.find("#oair_api_key").val(s.apiKey || "");
    fp.find("#oair_model").val(s.model || "");
    fp.find("#oair_timeout_ms").val(Number(s.timeoutMs) || defaultSettings.timeoutMs);
    fp.find("#oair_prompt_template").val(s.promptTemplate || "");
    fp.find("#oair_images_prompt_template").val(s.imagesPromptTemplate || "");
    fp.find("#oair_image_size").val(s.imageSize || "1024x1024");
    fp.find("#oair_image_count").val(Number(s.imageCount) || 1);
    fp.find("#oair_image_response_format").val(s.imageResponseFormat || "url");
    fp.find("#oair_extra_body").val(s.extraBody || "");

    // Toggle API mode field visibility (scoped)
    const isImagesMode = (s.apiMode || "chat") === "images";
    fp.find(".oair-images-api-fields").toggle(isImagesMode);
    fp.find(".oair-chat-api-fields").toggle(!isImagesMode);

    // 提取
    fp.find("#oair_extraction_regex").val(s.extractionRegex || "");
    fp.find("#oair_response_image_regex").val(s.responseImageRegex || "");

    // 优化
    fp.find("#oair_optimize_enabled").prop("checked", !!s.optimizeEnabled);
    fp.find("#oair_optimize_auto").prop("checked", !!s.optimizeAuto);
    fp.find("#oair_optimize_template").val(s.optimizeTemplate || "");
    fp.find("#oair_optimize_api_url").val(s.optimizeApiUrl || "");
    fp.find("#oair_optimize_model").val(s.optimizeModel || "");
    fp.find("#oair_optimize_api_key").val(s.optimizeApiKey || "");

    // NSFW 规避
    fp.find("#oair_nsfw_avoidance").prop("checked", !!s.nsfwAvoidance);
    fp.find("#oair_nsfw_avoidance_template").val(s.nsfwAvoidanceTemplate || "");
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: MAIN PROMPT INJECTION & STATUS
// ═══════════════════════════════════════════════════════════════

function ensureSettings() {
    const current = extension_settings[extensionName] || {};
    extension_settings[extensionName] = {
        ...structuredClone(defaultSettings),
        ...current,
    };
}

function applyMainPromptInjection() {
    const settings = extension_settings[extensionName];
    const prompt = String(settings?.mainPrompt || "").trim();

    if (!settings?.enabled || !prompt) {
        setExtensionPrompt(mainPromptKey, "", extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
        return;
    }

    setExtensionPrompt(
        mainPromptKey,
        prompt,
        extension_prompt_types.BEFORE_PROMPT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

function setStatus(text, kind = "info") {
    const colors = {
        info: "cyan",
        success: "#90ff90",
        warning: "#ffd280",
        error: "#ff9090",
    };
    const color = colors[kind] || colors.info;

    // Update panel status
    $("#oair_status").text(text).css("color", color);

    // Update floating window status
    $("#oair_floating_status").text(text).css("color", color);

    // Update FAB state
    updateFabStatus(kind);
}

function updateFabStatus(kind) {
    const fab = $("#oair_fab");
    if (!fab.length) return;

    // Only manage loading/success/error states here
    // Don't touch loading state for general "info" messages
    if (kind === "success") {
        fab.removeClass("oair-fab--loading oair-fab--error");
        fab.addClass("oair-fab--success");
        setTimeout(() => fab.removeClass("oair-fab--success"), 2000);
    } else if (kind === "error") {
        fab.removeClass("oair-fab--loading oair-fab--success");
        fab.addClass("oair-fab--error");
        setTimeout(() => fab.removeClass("oair-fab--error"), 2000);
    }
    // "info" and "warning" don't change FAB state automatically
}

function setButtonLoading(selector, loading) {
    const btn = $(selector);
    if (loading) {
        btn.data("original-text", btn.html());
        btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> 处理中...');
    } else {
        btn.prop("disabled", false).html(btn.data("original-text") || btn.html());
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: PROMPT PIPELINE (optimize + sanitize)
// ═══════════════════════════════════════════════════════════════

/**
 * 通用 LLM 调用 — 始终使用 /v1/chat/completions
 */
async function callLlmForText(systemPrompt, userPrompt) {
    const settings = extension_settings[extensionName];
    const apiUrl = String(settings.optimizeApiUrl || "").trim() || settings.serviceUrl;
    const model = String(settings.optimizeModel || "").trim() || settings.model;
    const apiKey = String(settings.optimizeApiKey || "").trim() || settings.apiKey;
    const endpoint = resolveEndpoint(apiUrl, "chat");

    const body = {
        model,
        stream: false,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
    };

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        { method: "POST", headers, body: JSON.stringify(body) },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    return extractContentFromPayload(data).trim();
}

/**
 * 使用 LLM 优化提示词
 */
async function optimizePrompt(prompt) {
    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) return prompt;

    const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
    const systemPrompt = "你是一个专业的图片提示词优化专家。";
    const userMessage = renderPrompt(template, prompt);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] Prompt optimization failed, using original`, error);
        return prompt;
    }
}

/**
 * NSFW 安全审查 — 使用 LLM 净化提示词
 */
async function sanitizePrompt(prompt) {
    const settings = extension_settings[extensionName];
    if (!settings.nsfwAvoidance) return prompt;

    const template = settings.nsfwAvoidanceTemplate || defaultSettings.nsfwAvoidanceTemplate;
    const systemPrompt = "你是一个内容安全审查专家。";
    const userMessage = renderPrompt(template, prompt);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] NSFW sanitization failed, using original prompt`, error);
        return prompt;
    }
}

/**
 * 提示词处理流水线：原始 → 优化 → 安全审查
 * @param {string} prompt - 原始提示词
 * @param {object} options - { forceOptimize: boolean }
 */
async function processPromptPipeline(prompt, options = {}) {
    const settings = extension_settings[extensionName];

    // Step 1: 优化（如果启用且满足条件）
    const shouldOptimize = options.forceOptimize || settings.optimizeAuto;
    if (settings.optimizeEnabled && shouldOptimize) {
        setStatus("正在优化提示词...", "info");
        prompt = await optimizePrompt(prompt);
    }

    // Step 2: NSFW 安全审查（如果启用）
    if (settings.nsfwAvoidance) {
        setStatus("正在安全审查...", "info");
        prompt = await sanitizePrompt(prompt);
    }

    return prompt;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: IMAGE REQUEST — DISPATCHER
// ═══════════════════════════════════════════════════════════════

/**
 * 图片请求分发器 — 根据 apiMode 选择不同后端
 */
async function requestImagesFromBackend(prompt) {
    const settings = extension_settings[extensionName];
    if (settings.apiMode === "images") {
        return requestViaImagesGenerations(prompt);
    }
    return requestViaChatCompletions(prompt);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9: IMAGE REQUEST — CHAT COMPLETIONS MODE
// ═══════════════════════════════════════════════════════════════

async function requestViaChatCompletions(prompt) {
    const settings = extension_settings[extensionName];
    const endpoint = resolveEndpoint(settings.serviceUrl, "chat");
    const userPrompt = renderPrompt(settings.promptTemplate, prompt);
    const extraBody = parseOptionalJson(settings.extraBody, "额外请求体 JSON");

    const body = {
        ...extraBody,
        model: String(settings.model || defaultSettings.model),
        stream: false,
        messages: [{ role: "user", content: userPrompt }],
    };

    const headers = {
        "Content-Type": "application/json",
    };

    const apiKey = String(settings.apiKey || "").trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    const content = extractContentFromPayload(data);
    const images = extractImagesFromPayload(data, endpoint, settings.responseImageRegex);

    return {
        images,
        content,
        raw: data,
    };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 10: IMAGE REQUEST — IMAGES API MODE
// ═══════════════════════════════════════════════════════════════

// resolveImagesApiUrl 已被统一的 resolveEndpoint(rawUrl, "images") 替代

/**
 * 通过 /v1/images/generations 接口生图
 */
async function requestViaImagesGenerations(prompt) {
    const settings = extension_settings[extensionName];
    const endpoint = resolveEndpoint(settings.serviceUrl, "images");
    const template = settings.imagesPromptTemplate || defaultSettings.imagesPromptTemplate;
    const finalPrompt = renderPrompt(template, prompt);
    const extraBody = parseOptionalJson(settings.extraBody, "额外请求体 JSON");

    const body = {
        ...extraBody,
        model: String(settings.model || defaultSettings.model),
        prompt: finalPrompt,
        n: Number(settings.imageCount) || 1,
        size: String(settings.imageSize || "1024x1024"),
        response_format: String(settings.imageResponseFormat || "url"),
    };

    const headers = {
        "Content-Type": "application/json",
    };

    const apiKey = String(settings.apiKey || "").trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    const images = extractImagesFromImagesApiResponse(data);

    return {
        images,
        content: "",
        raw: data,
    };
}

/**
 * 解析 /v1/images/generations 响应
 */
function extractImagesFromImagesApiResponse(data) {
    const images = [];

    if (Array.isArray(data?.data)) {
        for (const item of data.data) {
            if (typeof item === "string" && looksLikeImageRef(item)) {
                images.push(item);
                continue;
            }

            if (!item || typeof item !== "object") continue;

            if (item.url) {
                images.push(item.url);
            }
            if (item.b64_json) {
                const fmt = String(item.format || "png").toLowerCase();
                images.push(`data:image/${fmt};base64,${item.b64_json}`);
            }
        }
    }

    // 兜底：检查顶层 images 字段
    if (Array.isArray(data?.images)) {
        for (const item of data.images) {
            if (typeof item === "string" && looksLikeImageRef(item)) {
                images.push(item);
            } else if (item?.url) {
                images.push(item.url);
            } else if (item?.b64_json) {
                const fmt = String(item.format || "png").toLowerCase();
                images.push(`data:image/${fmt};base64,${item.b64_json}`);
            }
        }
    }

    return dedupeStrings(images);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 11: MESSAGE PROCESSING (auto pipeline)
// ═══════════════════════════════════════════════════════════════

async function onMessageReceived(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings?.enabled || !Number.isInteger(messageId)) {
        return;
    }

    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system || !message.mes) {
        return;
    }

    let extractionRegex;
    try {
        extractionRegex = parseRegex(settings.extractionRegex, "提取提示词正则");
    } catch (error) {
        setStatus(error.message, "error");
        return;
    }

    const matches = collectMatches(message.mes, extractionRegex);
    if (!matches.length) {
        return;
    }

    const inFlightKey = `${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) {
        return;
    }

    inFlightMessages.add(inFlightKey);
    setStatus(`正在处理 ${matches.length} 处匹配...`, "info");

    try {
        const replacements = [];
        const collectedImages = [];
        const collectedTitles = [];
        let successCount = 0;

        for (const match of matches) {
            let prompt = String(match.capture || "").trim();
            if (!prompt) {
                replacements.push(match.fullMatch);
                continue;
            }

            // 运行提示词处理流水线
            prompt = await processPromptPipeline(prompt, { forceOptimize: false });

            const result = await requestImagesFromBackend(prompt);
            if (!result.images.length) {
                replacements.push(match.fullMatch);
                continue;
            }

            replacements.push("");
            collectedImages.push(...result.images);
            collectedTitles.push(prompt);
            successCount += 1;
        }

        if (!successCount) {
            setStatus("未检测到图片输出", "warning");
            return;
        }

        message.mes = cleanupMessageText(applyReplacements(message.mes, matches, replacements));
        message.extra = message.extra || {};
        attachGeneratedImages(message, collectedImages, collectedTitles);
        message.extra[extensionName] = {
            lastRunAt: Date.now(),
            replacements: successCount,
            images: dedupeStrings(collectedImages).length,
        };

        updateMessageBlock(messageId, message);
        await context.saveChat();
        setStatus(`已替换 ${successCount} 处匹配`, "success");
    } catch (error) {
        console.error(`[${extensionName}] Message processing failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12: MANUAL GENERATION
// ═══════════════════════════════════════════════════════════════

async function manualGenerate() {
    const fp = $("#oair_floating_panel");
    let prompt = String(fp.find("#oair_manual_prompt").val() || "").trim();
    if (!prompt) {
        toastr.warning("请先输入提示词。");
        return;
    }

    setStatus("手动生图中...", "info");
    setButtonLoading("#oair_btn_manual_gen", true);
    $("#oair_fab").addClass("oair-fab--loading");

    try {
        // 如果有优化后的提示词，使用优化版本
        const optimizedText = String(fp.find("#oair_manual_optimized_text").text() || "").trim();
        if (optimizedText) {
            prompt = optimizedText;
        }

        // 运行 NSFW 安全审查
        prompt = await sanitizePrompt(prompt);

        const result = await requestImagesFromBackend(prompt);
        renderManualPreview(result.images, result.content);

        if (result.images.length > 0) {
            setStatus(`已生成 ${result.images.length} 张图片`, "success");
            toastr.success(`已生成 ${result.images.length} 张图片。`);
            $("#oair_fab").removeClass("oair-fab--loading").addClass("oair-fab--success");
            setTimeout(() => $("#oair_fab").removeClass("oair-fab--success"), 2000);
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
            $("#oair_fab").removeClass("oair-fab--loading");
        }
    } catch (error) {
        console.error(`[${extensionName}] Manual generation failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
        $("#oair_fab").removeClass("oair-fab--loading").addClass("oair-fab--error");
        setTimeout(() => $("#oair_fab").removeClass("oair-fab--error"), 2000);
    } finally {
        setButtonLoading("#oair_btn_manual_gen", false);
    }
}

async function manualOptimize() {
    const fp = $("#oair_floating_panel");
    const prompt = String(fp.find("#oair_manual_prompt").val() || "").trim();
    if (!prompt) {
        toastr.warning("请先输入提示词。");
        return;
    }

    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) {
        toastr.warning("请先在「优化」标签页启用提示词优化功能。");
        return;
    }

    setStatus("正在优化提示词...", "info");
    setButtonLoading("#oair_btn_optimize", true);

    try {
        const optimized = await optimizePrompt(prompt);
        if (optimized && optimized !== prompt) {
            fp.find("#oair_manual_optimized_text").text(optimized);
            fp.find("#oair_manual_optimized_prompt").show();
            setStatus("提示词已优化", "success");
            toastr.success("提示词优化完成，可查看优化结果。");
        } else if (optimized === prompt) {
            setStatus("提示词无需优化", "info");
            toastr.info("优化结果与原始提示词相同，将使用原始提示词。");
        } else {
            setStatus("优化失败，将使用原始提示词", "warning");
        }
    } catch (error) {
        console.error(`[${extensionName}] Manual optimization failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        setButtonLoading("#oair_btn_optimize", false);
    }
}

function renderManualPreview(images, content = "") {
    const fp = $("#oair_floating_panel");
    const preview = fp.find("#oair_manual_preview");
    preview.empty();

    for (const imageUrl of images) {
        $("<img>")
            .attr("src", imageUrl)
            .css({
                width: "100%",
                maxWidth: "100%",
                borderRadius: "6px",
                cursor: "pointer",
            })
            .on("click", () => window.open(imageUrl, "_blank"))
            .appendTo(preview);
    }

    if (!images.length && content) {
        $("<pre>")
            .text(content)
            .css({
                whiteSpace: "pre-wrap",
                margin: 0,
                padding: "8px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: "6px",
                fontSize: "0.8em",
            })
            .appendTo(preview);
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 13: MESSAGE IMAGE GENERATION (feat 6 & 7)
// ═══════════════════════════════════════════════════════════════

/**
 * 消息渲染时注入生图按钮
 */
function onMessageRendered(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings?.enabled || settings.messageGenEnabled === false) return;

    const mesBlock = $(`.mes[mesid="${messageId}"]`);
    if (!mesBlock.length) return;

    // 避免重复注入
    if (mesBlock.find('.oair-msg-action').length) return;

    const buttonsArea = mesBlock.find('.mes_buttons');
    if (!buttonsArea.length) return;

    // 「使用此消息内容生图」按钮
    $('<div class="oair-msg-action mes_button" title="使用此消息内容生图">')
        .html('<i class="fa-solid fa-image"></i>')
        .on('click', (e) => {
            e.stopPropagation();
            generateFromMessage(messageId);
        })
        .appendTo(buttonsArea);

    // 「总结此消息并生图」按钮
    $('<div class="oair-msg-action mes_button" title="总结此消息并生图">')
        .html('<i class="fa-solid fa-wand-magic-sparkles"></i>')
        .on('click', (e) => {
            e.stopPropagation();
            summarizeAndGenerate(messageId);
        })
        .appendTo(buttonsArea);
}

/**
 * 使用消息内容直接生图
 */
async function generateFromMessage(messageId) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message?.mes) {
        toastr.warning("无法读取消息内容。");
        return;
    }

    let prompt = stripHtmlTags(message.mes).trim();
    if (!prompt) {
        toastr.warning("消息内容为空。");
        return;
    }

    const inFlightKey = `msg:${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) return;
    inFlightMessages.add(inFlightKey);

    try {
        setStatus("正在从消息生图...", "info");
        prompt = await processPromptPipeline(prompt, { forceOptimize: false });
        const result = await requestImagesFromBackend(prompt);

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "message-gen",
            };
            updateMessageBlock(messageId, message);
            await context.saveChat();
            setStatus("消息生图完成", "success");
            toastr.success("消息生图完成！");
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
        }
    } catch (error) {
        console.error(`[${extensionName}] Message generation failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

/**
 * 总结消息内容并生图
 */
async function summarizeAndGenerate(messageId) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message?.mes) {
        toastr.warning("无法读取消息内容。");
        return;
    }

    const inFlightKey = `sum:${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) return;
    inFlightMessages.add(inFlightKey);

    try {
        setStatus("正在总结消息...", "info");
        const prompt = await summarizeMessageToPrompt(message.mes);
        if (!prompt) {
            setStatus("总结失败", "warning");
            toastr.warning("消息总结失败，请检查优化配置。");
            return;
        }

        setStatus("正在生图...", "info");
        // 总结模板已包含 SFW 指令，但额外运行安全审查
        const sanitizedPrompt = await sanitizePrompt(prompt);
        const result = await requestImagesFromBackend(sanitizedPrompt);

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "summarize-gen",
            };
            updateMessageBlock(messageId, message);
            await context.saveChat();
            setStatus("总结生图完成", "success");
            toastr.success("总结生图完成！");
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
        }
    } catch (error) {
        console.error(`[${extensionName}] Summarize-generate failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

/**
 * 使用 LLM 将消息内容总结为生图提示词
 */
async function summarizeMessageToPrompt(messageContent) {
    const settings = extension_settings[extensionName];
    const template = settings.summarizeTemplate || defaultSettings.summarizeTemplate;
    const systemPrompt = "你是一个擅长将文字内容转化为图片提示词的专家。";
    const userMessage = renderPromptWithMessage(template, messageContent);

    try {
        return await callLlmForText(systemPrompt, userMessage);
    } catch (error) {
        console.warn(`[${extensionName}] Summarization failed`, error);
        return "";
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 14: HTTP & PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
            const message = text?.trim() || `HTTP ${response.status}`;
            throw new Error(`后端请求失败：${message}`);
        }

        return text;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("后端请求超时。");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function parseBackendPayload(text) {
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return {
            choices: [
                {
                    message: {
                        content: text,
                    },
                },
            ],
        };
    }
}

function extractContentFromPayload(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (item?.type === "text") {
                    return item.text || "";
                }

                return "";
            })
            .join("");
    }

    return "";
}

function extractImagesFromPayload(data, endpoint, responseImageRegexSetting) {
    const collected = [];
    const structuredSources = [
        data?.media,
        data?.choices?.[0]?.message?.media,
        data?.images,
        data?.choices?.[0]?.message?.images,
        data?.choices?.[0]?.message?.content,
    ];

    for (const source of structuredSources) {
        collectStructuredImages(source, endpoint, collected);
    }

    const content = extractContentFromPayload(data);
    if (content) {
        const customRegex = safeParseRegex(responseImageRegexSetting);
        if (customRegex) {
            collectImagesFromText(content, customRegex, endpoint, collected);
        }

        collectImagesFromText(content, markdownImageRegex, endpoint, collected);
        collectImagesFromText(content, looseImageUrlRegex, endpoint, collected);
    }

    return dedupeStrings(collected);
}

function collectStructuredImages(source, endpoint, output) {
    if (!source) {
        return;
    }

    if (typeof source === "string") {
        if (looksLikeImageRef(source)) {
            pushImageCandidate(source, endpoint, output);
        }
        return;
    }

    if (!Array.isArray(source)) {
        return;
    }

    for (const item of source) {
        if (typeof item === "string") {
            if (looksLikeImageRef(item)) {
                pushImageCandidate(item, endpoint, output);
            }
            continue;
        }

        if (!item || typeof item !== "object") {
            continue;
        }

        const mediaType = String(item.media_type || item.type || "image").toLowerCase();
        if (mediaType && !["image", "image_url", "input_image"].includes(mediaType)) {
            continue;
        }

        const imageUrlValue = typeof item.image_url === "string"
            ? item.image_url
            : item.image_url?.url;

        pushImageCandidate(item.url || item.data_uri || imageUrlValue, endpoint, output);

        if (item.b64_json) {
            const format = String(item.format || "png").toLowerCase();
            pushImageCandidate(`data:image/${format};base64,${item.b64_json}`, endpoint, output);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 15: TEXT & REGEX UTILITIES
// ═══════════════════════════════════════════════════════════════

function looksLikeImageRef(value) {
    const text = String(value || "").trim();
    if (!text) {
        return false;
    }

    if (text.startsWith("data:image")) {
        return true;
    }

    looseImageUrlRegex.lastIndex = 0;
    return looseImageUrlRegex.test(text);
}

function collectImagesFromText(text, regex, endpoint, output) {
    for (const match of collectMatches(text, regex)) {
        pushImageCandidate(match.capture || match.fullMatch, endpoint, output);
    }
}

function pushImageCandidate(candidate, endpoint, output) {
    const normalized = normalizeImageRef(candidate, endpoint);
    if (normalized) {
        output.push(normalized);
    }
}

function normalizeImageRef(candidate, endpoint) {
    const value = String(candidate || "").trim();
    if (!value) {
        return "";
    }

    if (value.startsWith("data:image")) {
        return value;
    }

    try {
        return new URL(value, endpoint).toString();
    } catch {
        return value;
    }
}

function applyReplacements(text, matches, replacements) {
    let cursor = 0;
    let output = "";

    matches.forEach((match, index) => {
        output += text.slice(cursor, match.index);
        output += replacements[index] ?? match.fullMatch;
        cursor = match.index + match.fullMatch.length;
    });

    output += text.slice(cursor);
    return output;
}

function cleanupMessageText(text) {
    return String(text || "")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function collectMatches(text, regex) {
    const sourceText = String(text || "");
    if (!sourceText) {
        return [];
    }

    const flags = regex.flags || "";
    const runner = new RegExp(regex.source, regex.global ? flags : `${flags}g`);
    const results = [];

    for (let match = runner.exec(sourceText); match; match = runner.exec(sourceText)) {
        results.push({
            index: match.index,
            fullMatch: match[0],
            capture: extractCapture(match),
        });

        if (!regex.global) {
            break;
        }

        if (match[0] === "") {
            runner.lastIndex += 1;
        }
    }

    return results;
}

function extractCapture(match) {
    if (match?.groups?.prompt) {
        return match.groups.prompt;
    }

    for (let index = 1; index < match.length; index++) {
        if (typeof match[index] === "string" && match[index].length > 0) {
            return match[index];
        }
    }

    return match[0] || "";
}

function dedupeStrings(values) {
    return [...new Set(values.filter(Boolean))];
}

function renderPrompt(template, prompt) {
    const source = String(template || defaultSettings.promptTemplate);
    return source.replaceAll("{{prompt}}", String(prompt || "").trim());
}

function renderPromptWithMessage(template, message) {
    return String(template || "")
        .replaceAll("{{message}}", String(message || "").trim())
        .replaceAll("{{prompt}}", String(message || "").trim());
}

function parseRegex(value, label) {
    const regex = safeParseRegex(value);
    if (!regex) {
        throw new Error(`${label} 格式无效。`);
    }
    return regex;
}

function safeParseRegex(value) {
    return regexFromString(String(value || "").trim());
}

function parseOptionalJson(value, label) {
    const text = String(value || "").trim();
    if (!text) {
        return {};
    }

    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error();
        }
        return parsed;
    } catch {
        throw new Error(`${label} 格式无效。`);
    }
}

/**
 * 从 serviceUrl 提取 base URL（到 /v1 为止），
 * 然后根据 apiMode 自动拼接后续路径
 * @param {string} rawUrl - 用户填写的服务地址
 * @param {"chat"|"images"|"models"} apiMode - API 模式
 * @returns {string} 完整端点 URL
 */
function resolveEndpoint(rawUrl, apiMode) {
    const input = String(rawUrl || "").trim();
    if (!input) {
        throw new Error("服务地址不能为空。");
    }

    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error("服务地址格式无效。");
    }

    // Strip trailing slashes
    let pathname = url.pathname.replace(/\/+$/, "");

    // Strip known suffixes to get base path
    pathname = pathname.replace(/\/(chat\/completions|images\/generations|models)$/i, "");

    // Append the correct path based on apiMode
    const suffixMap = {
        chat: "/chat/completions",
        images: "/images/generations",
        models: "/models",
    };
    const suffix = suffixMap[apiMode] || "/chat/completions";
    url.pathname = pathname + suffix;

    return url.toString();
}

/**
 * 获取模型列表 — 调用 /v1/models
 */
async function fetchModelList() {
    const settings = extension_settings[extensionName];
    const endpoint = resolveEndpoint(settings.serviceUrl, "models");
    const apiKey = String(settings.apiKey || "").trim();

    const headers = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        { method: "GET", headers },
        10000, // 10s timeout for model list
    );

    const data = JSON.parse(responseText);
    if (Array.isArray(data?.data)) {
        return data.data
            .map(m => m.id || m.name || "")
            .filter(id => id.length > 0)
            .sort();
    }
    throw new Error("模型列表格式无效");
}

function stripHtmlTags(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

// ═══════════════════════════════════════════════════════════════
// SECTION 16: IMAGE HANDLING UTILITIES
// ═══════════════════════════════════════════════════════════════

function attachGeneratedImages(message, images, titles) {
    const newImages = dedupeStrings(images);
    if (!newImages.length) {
        return;
    }

    const extra = message.extra || {};
    const existingImages = [];

    if (Array.isArray(extra.image_swipes)) {
        existingImages.push(...extra.image_swipes);
    }

    if (extra.image) {
        existingImages.push(extra.image);
    }

    const mergedImages = dedupeStrings([...newImages, ...existingImages]);
    const firstTitle = titles.find((title) => String(title || "").trim().length > 0);

    extra.image_swipes = mergedImages;
    extra.image = newImages[0];
    extra.inline_image = true;

    if (firstTitle) {
        extra.title = firstTitle;
    }

    message.extra = extra;
}
