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

// 动态检测实际扩展文件夹名（仓库名可能与 extensionName 不同）
function detectExtensionPath() {
    // 方法1: 使用 import.meta.url（ES模块最可靠的方式）
    try {
        const url = new URL(import.meta.url);
        const match = url.pathname.match(/^\/(scripts\/extensions\/third-party\/[^/]+)/);
        if (match) return match[1];
    } catch (e) {
        // import.meta 可能不可用，继续尝试其他方法
    }

    // 方法2: 从 <script> 标签的 src 属性提取路径
    const scripts = document.querySelectorAll('script[src*="extensions/third-party"]');
    for (const s of scripts) {
        const m = s.src.match(/scripts\/extensions\/third-party\/([^/]+)\//);
        if (m) return `scripts/extensions/third-party/${m[1]}`;
    }

    // 方法3: 回退到默认（使用 extensionName）
    console.warn(`[${extensionName}] Could not detect extension folder path, using default: ${extensionName}`);
    return `scripts/extensions/third-party/${extensionName}`;
}
const extensionFolderPath = detectExtensionPath();

const mainPromptKey = `${extensionName}-MAIN-PROMPT`;
// 使用工厂函数避免全局正则 lastIndex 状态共享问题
const markdownImageRegex = () => /!\[[^\]]*]\(([^)\s]+)\)/g;
const looseImageUrlRegex = () => /((?:https?:\/\/|\/)[^\s)"']+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s)"']*)?)/gi;
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
    optimizeUseCustom: false,                      // 是否使用自定义优化LLM后端
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
// SECTION 2.5: INLINE HTML TEMPLATES (fallback when $.get fails)
// ═══════════════════════════════════════════════════════════════

const SETTINGS_PANEL_HTML = "<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- \u9762\u677f\u7cbe\u7b80\u7248 \u2014 \u53ea\u4fdd\u7559\u57fa\u7840\u5f00\u5173\u548c\u72b6\u6001 -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"oair-panel-ui\">\n    <!-- \u72b6\u6001\u680f -->\n    <div style=\"display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; gap:8px;\">\n        <div id=\"oair_status\" style=\"font-size:0.8em; color:cyan;\">\u5c31\u7eea</div>\n        <label style=\"display:flex; align-items:center; gap:6px; font-size:0.8em; white-space:nowrap;\">\n            <input id=\"oair_enabled\" type=\"checkbox\">\n            \u542f\u7528\n        </label>\n    </div>\n\n    <!-- \u60ac\u6d6e\u5feb\u6377\u6309\u94ae\u5f00\u5173 -->\n    <div class=\"oair-section\">\n        <label class=\"oair-toggle-label\">\n            <input id=\"oair_fab_enabled\" type=\"checkbox\">\n            \u663e\u793a\u60ac\u6d6e\u5feb\u6377\u6309\u94ae\n        </label>\n        <div class=\"oair-hint\">\n            \u52fe\u9009\u540e\u5c4f\u5e55\u53f3\u4e0b\u89d2\u51fa\u73b0\u53ef\u62d6\u62fd\u7684\u5feb\u6377\u6309\u94ae\uff0c\u70b9\u51fb\u6253\u5f00\u8be6\u7ec6\u914d\u7f6e\u7a97\u53e3\u3002<br>\n            \u9002\u5408\u9700\u8981\u9891\u7e41\u4f7f\u7528\u624b\u52a8\u751f\u56fe\u6216\u8c03\u6574\u914d\u7f6e\u7684\u573a\u666f\u3002\n        </div>\n    </div>\n\n    <!-- \u5feb\u6377\u5165\u53e3 -->\n    <div class=\"oair-section\" style=\"margin-top:4px;\">\n        <button id=\"oair_btn_open_floating\" class=\"menu_button\" style=\"width:100%; justify-content:center;\">\n            \ud83d\uddbc\ufe0f \u6253\u5f00\u8be6\u7ec6\u914d\u7f6e\u7a97\u53e3\n        </button>\n        <div class=\"oair-hint\" style=\"margin-top:4px; text-align:center;\">\n            \u6216\u4f7f\u7528\u60ac\u6d6e\u5feb\u6377\u6309\u94ae\u5feb\u901f\u8bbf\u95ee\n        </div>\n    </div>\n</div>\n";

const SETTINGS_FULL_HTML = "<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- \u5b8c\u6574\u914d\u7f6e\u7248 \u2014 \u7528\u4e8e\u60ac\u6d6e\u7a97\uff085\u6807\u7b7e\u9875\u5b8c\u6574\u914d\u7f6e\uff09 -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<style>\n    /* \u2500\u2500\u2500 \u6807\u7b7e\u9875\u5bb9\u5668 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-tabs-container {\n        display: flex;\n        flex-direction: column;\n        gap: 0;\n    }\n    .oair-tab-bar {\n        display: flex;\n        gap: 2px;\n        border-bottom: 1px solid rgba(255,255,255,0.15);\n        margin-bottom: 8px;\n        flex-wrap: wrap;\n    }\n    .oair-tab-label {\n        padding: 5px 10px;\n        font-size: 0.78em;\n        cursor: pointer;\n        border-radius: 4px 4px 0 0;\n        opacity: 0.55;\n        transition: all 0.15s;\n        user-select: none;\n        white-space: nowrap;\n    }\n    .oair-tab-label:hover {\n        opacity: 0.85;\n        background: rgba(255,255,255,0.05);\n    }\n    .oair-tab-panel {\n        display: none;\n    }\n\n    /* \u6fc0\u6d3b\u6807\u7b7e\u6837\u5f0f */\n    #oair_tab_basic:checked ~ .oair-tab-bar label[for=\"oair_tab_basic\"],\n    #oair_tab_backend:checked ~ .oair-tab-bar label[for=\"oair_tab_backend\"],\n    #oair_tab_extract:checked ~ .oair-tab-bar label[for=\"oair_tab_extract\"],\n    #oair_tab_optimize:checked ~ .oair-tab-bar label[for=\"oair_tab_optimize\"],\n    #oair_tab_manual:checked ~ .oair-tab-bar label[for=\"oair_tab_manual\"] {\n        opacity: 1;\n        background: rgba(255,255,255,0.1);\n        border-bottom: 2px solid cyan;\n    }\n\n    /* \u663e\u793a\u5bf9\u5e94\u9762\u677f */\n    #oair_tab_basic:checked ~ #oair_panel_basic,\n    #oair_tab_backend:checked ~ #oair_panel_backend,\n    #oair_tab_extract:checked ~ #oair_panel_extract,\n    #oair_tab_optimize:checked ~ #oair_panel_optimize,\n    #oair_tab_manual:checked ~ #oair_panel_manual {\n        display: block;\n    }\n\n    /* \u2500\u2500\u2500 \u901a\u7528\u7ec4\u4ef6\u6837\u5f0f \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-section {\n        background: rgba(0,0,0,0.15);\n        padding: 10px;\n        border-radius: 6px;\n        margin-bottom: 8px;\n    }\n    .oair-section-title {\n        font-weight: bold;\n        font-size: 0.88em;\n        margin-bottom: 8px;\n        display: flex;\n        align-items: center;\n        gap: 6px;\n    }\n    .oair-field-label {\n        display: block;\n        font-size: 0.75em;\n        opacity: 0.8;\n        margin-top: 6px;\n        margin-bottom: 2px;\n    }\n    .oair-hint {\n        margin-top: 4px;\n        font-size: 0.72em;\n        opacity: 0.6;\n        line-height: 1.4;\n    }\n    .oair-row {\n        display: grid;\n        grid-template-columns: 1fr 1fr;\n        gap: 6px;\n        margin-top: 6px;\n    }\n    .oair-btn-row {\n        display: flex;\n        gap: 6px;\n        margin-top: 6px;\n    }\n    .oair-optimized-box {\n        background: rgba(0,200,100,0.08);\n        border: 1px solid rgba(0,200,100,0.25);\n        border-radius: 6px;\n        padding: 8px;\n        margin-top: 6px;\n        font-size: 0.85em;\n        line-height: 1.5;\n        white-space: pre-wrap;\n        word-break: break-all;\n    }\n    .oair-toggle-row {\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        gap: 8px;\n    }\n    .oair-toggle-label {\n        display: flex;\n        align-items: center;\n        gap: 6px;\n        font-size: 0.8em;\n    }\n    .oair-badge {\n        display: inline-block;\n        padding: 1px 6px;\n        border-radius: 3px;\n        font-size: 0.7em;\n        font-weight: bold;\n        vertical-align: middle;\n    }\n    .oair-badge-green {\n        background: rgba(0,200,100,0.2);\n        color: #60ff90;\n    }\n    .oair-badge-orange {\n        background: rgba(255,180,60,0.2);\n        color: #ffd280;\n    }\n    .oair-badge-red {\n        background: rgba(255,80,80,0.2);\n        color: #ff9090;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u8f93\u5165+\u6309\u94ae\u7ec4\u5408\u884c \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-input-with-btn {\n        display: flex;\n        gap: 6px;\n        align-items: center;\n    }\n    .oair-input-with-btn .text_pole {\n        flex: 1;\n        min-width: 0;\n    }\n    .oair-input-with-btn .menu_button {\n        flex-shrink: 0;\n        white-space: nowrap;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u5bc6\u7801\u884c\uff08\u8f93\u5165+\u773c\u775b\u6309\u94ae\uff09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-password-row {\n        display: flex;\n        gap: 6px;\n        align-items: center;\n    }\n    .oair-password-row .text_pole {\n        flex: 1;\n        min-width: 0;\n    }\n    .oair-password-row .oair-eye-btn {\n        flex-shrink: 0;\n        width: 32px;\n        height: 32px;\n        display: flex;\n        align-items: center;\n        justify-content: center;\n        background: rgba(255,255,255,0.08);\n        border: 1px solid rgba(255,255,255,0.15);\n        border-radius: 4px;\n        color: var(--SmartThemeBodyColor, #ccc);\n        cursor: pointer;\n        font-size: 13px;\n        transition: background 0.15s;\n    }\n    .oair-password-row .oair-eye-btn:hover {\n        background: rgba(255,255,255,0.15);\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u6a21\u578b\u884c\uff08\u8f93\u5165+\u83b7\u53d6\u6309\u94ae\uff09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-model-row {\n        display: flex;\n        gap: 6px;\n        align-items: center;\n    }\n    .oair-model-row .text_pole {\n        flex: 1;\n        min-width: 0;\n    }\n    .oair-model-row .menu_button {\n        flex-shrink: 0;\n        white-space: nowrap;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u6a21\u578b\u9009\u62e9\u4e0b\u62c9 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    #oair_model_select,\n    #oair_optimize_model_select {\n        width: 100%;\n        margin-top: 4px;\n        display: none;\n    }\n    #oair_model_select.oair-visible,\n    #oair_optimize_model_select.oair-visible {\n        display: block;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u4fdd\u5b58\u884c\uff08\u8d85\u65f6+\u4fdd\u5b58\u6309\u94ae\uff09 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-save-row {\n        display: flex;\n        gap: 6px;\n        align-items: center;\n    }\n    .oair-save-row .text_pole {\n        flex: 1;\n        min-width: 0;\n    }\n    .oair-save-row .menu_button {\n        flex-shrink: 0;\n        white-space: nowrap;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1aDetails/Summary \u6298\u53e0\u6837\u5f0f \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-details {\n        margin-top: 8px;\n    }\n    .oair-details summary {\n        font-size: 0.78em;\n        cursor: pointer;\n        opacity: 0.7;\n        padding: 4px 0;\n        user-select: none;\n        list-style: none;\n        display: flex;\n        align-items: center;\n        gap: 4px;\n    }\n    .oair-details summary::-webkit-details-marker {\n        display: none;\n    }\n    .oair-details summary::before {\n        content: \"\u25b8\";\n        display: inline-block;\n        width: 12px;\n        text-align: center;\n        transition: transform 0.15s;\n    }\n    .oair-details[open] summary::before {\n        transform: rotate(90deg);\n    }\n    .oair-details summary:hover {\n        opacity: 1;\n    }\n    .oair-details .oair-details-content {\n        margin-top: 6px;\n    }\n\n    /* \u2500\u2500\u2500 \u65b0\u589e\uff1a\u81ea\u5b9a\u4e49\u4f18\u5316LLM\u540e\u7aef\u590d\u9009\u6846\u5c55\u5f00 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */\n    .oair-custom-backend-content {\n        display: none;\n    }\n    .oair-custom-backend-content.oair-visible {\n        display: block;\n    }\n</style>\n\n<div class=\"oair-settings-ui\">\n    <!-- \u72b6\u6001\u680f\uff08\u60ac\u6d6e\u7a97\u5185\u4e5f\u6709\uff09 -->\n    <div style=\"display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; gap:8px;\">\n        <div id=\"oair_floating_status\" style=\"font-size:0.8em; color:cyan;\">\u5c31\u7eea</div>\n        <label style=\"display:flex; align-items:center; gap:6px; font-size:0.8em; white-space:nowrap;\">\n            <input id=\"oair_floating_enabled\" type=\"checkbox\">\n            \u542f\u7528\n        </label>\n    </div>\n\n    <!-- \u9690\u85cf\u7684 radio \u8f93\u5165 -->\n    <input type=\"radio\" name=\"oair_tab\" id=\"oair_tab_basic\" checked style=\"display:none\">\n    <input type=\"radio\" name=\"oair_tab\" id=\"oair_tab_backend\" style=\"display:none\">\n    <input type=\"radio\" name=\"oair_tab\" id=\"oair_tab_extract\" style=\"display:none\">\n    <input type=\"radio\" name=\"oair_tab\" id=\"oair_tab_optimize\" style=\"display:none\">\n    <input type=\"radio\" name=\"oair_tab\" id=\"oair_tab_manual\" style=\"display:none\">\n\n    <!-- \u6807\u7b7e\u680f -->\n    <div class=\"oair-tab-bar\">\n        <label for=\"oair_tab_basic\" class=\"oair-tab-label\">\ud83d\udccb \u57fa\u7840</label>\n        <label for=\"oair_tab_backend\" class=\"oair-tab-label\">\u2699\ufe0f \u540e\u7aef</label>\n        <label for=\"oair_tab_extract\" class=\"oair-tab-label\">\ud83d\udd0d \u63d0\u53d6</label>\n        <label for=\"oair_tab_optimize\" class=\"oair-tab-label\">\u2728 \u4f18\u5316</label>\n        <label for=\"oair_tab_manual\" class=\"oair-tab-label\">\ud83c\udfa8 \u624b\u52a8</label>\n    </div>\n\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <!-- TAB 1: \u57fa\u7840                                           -->\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <div class=\"oair-tab-panel\" id=\"oair_panel_basic\">\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u4e3b\u6a21\u578b\u63d0\u793a\u6ce8\u5165</div>\n            <details class=\"oair-details\">\n                <summary>\u4e16\u754c\u4e66\u5f0f\u9ed8\u8ba4\u63d0\u793a\u8bcd</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_main_prompt\" class=\"text_pole\" rows=\"12\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"\u8fd9\u91cc\u7684\u5185\u5bb9\u4f1a\u50cf\u5e38\u9a7b\u4e16\u754c\u4e66\u4e00\u6837\u6ce8\u5165\u5230\u4e3b\u6a21\u578b\u63d0\u793a\u94fe\u91cc\u3002\"></textarea>\n                    <div class=\"oair-hint\">\u8fd9\u6bb5\u6587\u5b57\u4f1a\u4ee5\u7cfb\u7edf\u89c4\u5219\u7684\u65b9\u5f0f\u81ea\u52a8\u6ce8\u5165\u5230\u4e3b\u6a21\u578b\u63d0\u793a\u94fe\u5f00\u5934\uff0c\u4e0d\u4f1a\u53d1\u9001\u7ed9\u56fe\u7247\u540e\u7aef\u3002</div>\n                </div>\n            </details>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u6d88\u606f\u751f\u56fe\u6309\u94ae</div>\n            <label class=\"oair-toggle-label\">\n                <input id=\"oair_message_gen_enabled\" type=\"checkbox\">\n                \u5728\u804a\u5929\u6d88\u606f\u4e0a\u663e\u793a\u751f\u56fe\u6309\u94ae\n            </label>\n            <div class=\"oair-hint\">\u542f\u7528\u540e\uff0c\u6bcf\u6761\u6d88\u606f\u7684\u64cd\u4f5c\u680f\u4f1a\u51fa\u73b0\u4e24\u4e2a\u6309\u94ae\uff1a<br>\n                \ud83d\uddbc\ufe0f \u76f4\u63a5\u751f\u56fe \u2014 \u4f7f\u7528\u6d88\u606f\u539f\u6587\u4f5c\u4e3a\u63d0\u793a\u8bcd<br>\n                \u2728 \u603b\u7ed3\u751f\u56fe \u2014 \u5148\u5c06\u6d88\u606f\u603b\u7ed3\u4e3a\u63d0\u793a\u8bcd\u518d\u751f\u56fe\n            </div>\n        </div>\n    </div>\n\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <!-- TAB 2: \u540e\u7aef                                           -->\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <div class=\"oair-tab-panel\" id=\"oair_panel_backend\">\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u5feb\u6377\u9884\u8bbe</div>\n            <button id=\"oair_btn_chatgpt2api_preset\" class=\"menu_button\" style=\"width:100%; justify-content:center;\">\u26a1 \u4e00\u952e chatgpt2api \u9884\u8bbe</button>\n            <div class=\"oair-hint\">\u4e00\u952e\u5207\u6362\u4e3a chatgpt2api \u63a8\u8350\u914d\u7f6e\uff1aImages \u6a21\u5f0f\u3001\u6a21\u578b gpt-image-2\u3001\u54cd\u5e94 b64_json\u3001\u63d0\u793a\u8bcd\u76f4\u901a\u3001\u6587\u672c\u6b65\u9aa4\u8d70\u9152\u9986\u4e3b\u6a21\u578b\u3002\u5e94\u7528\u540e\u8bf7\u786e\u8ba4\u670d\u52a1\u5730\u5740\u4e0e API \u5bc6\u94a5\u662f\u5426\u6b63\u786e\u3002</div>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">API \u6a21\u5f0f</div>\n            <label class=\"oair-field-label\">\u9009\u62e9\u63a5\u53e3\u7c7b\u578b</label>\n            <select id=\"oair_api_mode\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\">\n                <option value=\"chat\">Chat Completions (/v1/chat/completions)</option>\n                <option value=\"images\">Images API (/v1/images/generations)</option>\n            </select>\n            <div class=\"oair-hint\">\n                <b>Chat Completions</b>\uff1a\u901a\u8fc7\u804a\u5929\u63a5\u53e3\u751f\u56fe\uff0c\u540e\u7aef\u5728\u6587\u672c\u56de\u590d\u4e2d\u8fd4\u56de\u56fe\u7247\u94fe\u63a5<br>\n                <b>Images API</b>\uff1a\u4f7f\u7528 OpenAI \u6807\u51c6\u56fe\u7247\u751f\u6210\u63a5\u53e3\uff0c\u76f4\u63a5\u8fd4\u56de\u56fe\u7247\u6570\u636e\n            </div>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u8fde\u63a5\u914d\u7f6e</div>\n\n            <!-- \u670d\u52a1\u5730\u5740 -->\n            <label class=\"oair-field-label\">\u670d\u52a1\u5730\u5740</label>\n            <input id=\"oair_service_url\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"http://127.0.0.1:8199/v1\">\n            <div class=\"oair-hint\">\u53ea\u586b\u5230 /v1\uff0c\u8def\u5f84\u540e\u7f00\u6839\u636eAPI\u6a21\u5f0f\u81ea\u52a8\u8865\u5168</div>\n\n            <!-- API \u5bc6\u94a5\uff08\u5e26\u773c\u775b\u6309\u94ae\uff09 -->\n            <label class=\"oair-field-label\">API \u5bc6\u94a5</label>\n            <div class=\"oair-password-row\">\n                <input id=\"oair_api_key\" type=\"password\" class=\"text_pole\" placeholder=\"sk-any\">\n                <button type=\"button\" class=\"oair-eye-btn\" title=\"\u663e\u793a/\u9690\u85cf\u5bc6\u94a5\"><i class=\"fa-solid fa-eye\"></i></button>\n            </div>\n\n            <!-- \u6a21\u578b\uff08\u8f93\u5165+\u83b7\u53d6\u6309\u94ae+\u9690\u85cf\u4e0b\u62c9\uff09 -->\n            <label class=\"oair-field-label\">\u6a21\u578b</label>\n            <div class=\"oair-model-row\">\n                <input id=\"oair_model\" class=\"text_pole\" placeholder=\"any\">\n                <button id=\"oair_btn_fetch_model\" class=\"menu_button\">\u83b7\u53d6\u6a21\u578b</button>\n            </div>\n            <select id=\"oair_model_select\" class=\"text_pole\"></select>\n\n            <!-- \u8d85\u65f6+\u4fdd\u5b58\u6309\u94ae -->\n            <label class=\"oair-field-label\">\u8d85\u65f6\uff08\u6beb\u79d2\uff09</label>\n            <div class=\"oair-save-row\">\n                <input id=\"oair_timeout_ms\" type=\"number\" min=\"1000\" step=\"1000\" class=\"text_pole\" placeholder=\"120000\">\n                <button id=\"oair_btn_save_api\" class=\"menu_button\">\ud83d\udcbe \u4fdd\u5b58\u8bbe\u7f6e</button>\n            </div>\n        </div>\n\n        <!-- Chat Completions \u4e13\u5c5e\u5b57\u6bb5 -->\n        <div class=\"oair-section oair-chat-api-fields\">\n            <details class=\"oair-details\">\n                <summary>Chat Completions \u6a21\u677f</summary>\n                <div class=\"oair-details-content\">\n                    <label class=\"oair-field-label\">\u53d1\u9001\u7ed9\u56fe\u7247\u540e\u7aef\u7684\u6a21\u677f</label>\n                    <textarea id=\"oair_prompt_template\" class=\"text_pole\" rows=\"3\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"\u5728\u9700\u8981\u63d2\u5165\u63d0\u53d6\u5185\u5bb9\u7684\u4f4d\u7f6e\u4f7f\u7528 {{prompt}}\u3002\"></textarea>\n                    <div class=\"oair-hint\">\u5c06\u63d0\u53d6\u51fa\u7684\u63d0\u793a\u8bcd\u5305\u88c5\u540e\u53d1\u7ed9 chat completions \u540e\u7aef\u3002</div>\n                </div>\n            </details>\n        </div>\n\n        <!-- Images API \u4e13\u5c5e\u5b57\u6bb5 -->\n        <div class=\"oair-section oair-images-api-fields\" style=\"display:none;\">\n            <details class=\"oair-details\">\n                <summary>Images API \u53c2\u6570</summary>\n                <div class=\"oair-details-content\">\n                    <label class=\"oair-field-label\">\u53d1\u9001\u7ed9\u56fe\u7247\u540e\u7aef\u7684\u6a21\u677f</label>\n                    <textarea id=\"oair_images_prompt_template\" class=\"text_pole\" rows=\"2\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"{{prompt}}\uff08\u9ed8\u8ba4\u76f4\u901a\uff0c\u4e0d\u5305\u88c5\uff09\"></textarea>\n\n                    <div class=\"oair-row\">\n                        <div>\n                            <label class=\"oair-field-label\">\u56fe\u7247\u5c3a\u5bf8</label>\n                            <select id=\"oair_image_size\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\">\n                                <option value=\"256x256\">256x256</option>\n                                <option value=\"512x512\">512x512</option>\n                                <option value=\"1024x1024\">1024x1024</option>\n                                <option value=\"1024x1792\">1024x1792</option>\n                                <option value=\"1792x1024\">1792x1024</option>\n                            </select>\n                        </div>\n                        <div>\n                            <label class=\"oair-field-label\">\u751f\u6210\u6570\u91cf</label>\n                            <input id=\"oair_image_count\" type=\"number\" min=\"1\" max=\"10\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\">\n                        </div>\n                    </div>\n\n                    <label class=\"oair-field-label\">\u54cd\u5e94\u683c\u5f0f</label>\n                    <select id=\"oair_image_response_format\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\">\n                        <option value=\"url\">URL\uff08\u8fd4\u56de\u56fe\u7247\u94fe\u63a5\uff09</option>\n                        <option value=\"b64_json\">Base64\uff08\u8fd4\u56de\u56fe\u7247\u6570\u636e\uff09</option>\n                    </select>\n                </div>\n            </details>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u989d\u5916\u8bf7\u6c42\u4f53</div>\n            <label class=\"oair-field-label\">\u989d\u5916\u8bf7\u6c42\u4f53 JSON\uff08\u53ef\u9009\uff09</label>\n            <textarea id=\"oair_extra_body\" class=\"text_pole\" rows=\"3\" style=\"width:100%; box-sizing:border-box;\" placeholder='{\"preset_name\":\"image\"}'></textarea>\n        </div>\n    </div>\n\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <!-- TAB 3: \u63d0\u53d6                                           -->\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <div class=\"oair-tab-panel\" id=\"oair_panel_extract\">\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u63d0\u53d6\u63d0\u793a\u8bcd\u6b63\u5219</div>\n            <details class=\"oair-details\">\n                <summary>\u4ece\u52a9\u624b\u56de\u590d\u4e2d\u63d0\u53d6\u751f\u56fe\u63d0\u793a\u8bcd</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_extraction_regex\" class=\"text_pole\" rows=\"3\" style=\"width:100%; box-sizing:border-box;\" placeholder='/&lt;pic[^&gt;]*prompt=\"([^\"]+)\"[^&gt;]*&gt;/g'></textarea>\n                </div>\n            </details>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u8fd4\u56de\u56fe\u7247\u6b63\u5219\u56de\u9000</div>\n            <details class=\"oair-details\">\n                <summary>\u5f53\u540e\u7aef\u628a\u56fe\u7247\u94fe\u63a5\u653e\u5728\u6587\u672c\u91cc\u8fd4\u56de\u65f6\u4f7f\u7528</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_response_image_regex\" class=\"text_pole\" rows=\"2\" style=\"width:100%; box-sizing:border-box;\" placeholder='/!\\\\[[^\\\\]]*\\\\]\\\\(([^)\\\\s]+)\\\\)/g'></textarea>\n                    <div class=\"oair-hint\">\u6269\u5c55\u4f1a\u4f18\u5148\u8bfb\u53d6 <code>media</code> \u8fd9\u7c7b\u7ed3\u6784\u5316\u56fe\u7247\u5b57\u6bb5\u3002\u53ea\u6709\u5f53\u540e\u7aef\u628a\u56fe\u7247\u94fe\u63a5\u653e\u5728\u6587\u672c\u91cc\u8fd4\u56de\u65f6\uff0c\u624d\u4f1a\u4f7f\u7528\u8fd9\u91cc\u7684\u56de\u9000\u6b63\u5219\u3002</div>\n                </div>\n            </details>\n        </div>\n    </div>\n\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <!-- TAB 4: \u4f18\u5316                                           -->\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <div class=\"oair-tab-panel\" id=\"oair_panel_optimize\">\n        <!-- \u63d0\u793a\u8bcd\u4f18\u5316 -->\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u63d0\u793a\u8bcd\u4f18\u5316 <span class=\"oair-badge oair-badge-orange\">\u65b0</span></div>\n            <label class=\"oair-toggle-label\">\n                <input id=\"oair_optimize_enabled\" type=\"checkbox\">\n                \u542f\u7528\u63d0\u793a\u8bcd\u4f18\u5316\n            </label>\n            <div class=\"oair-hint\">\u4f7f\u7528 LLM \u81ea\u52a8\u4f18\u5316\u63d0\u793a\u8bcd\uff0c\u6dfb\u52a0\u753b\u9762\u7ec6\u8282\u3001\u6784\u56fe\u3001\u5149\u7ebf\u7b49\u63cf\u8ff0\u3002</div>\n\n            <div style=\"margin-top:8px;\">\n                <label class=\"oair-toggle-label\">\n                    <input id=\"oair_optimize_auto\" type=\"checkbox\">\n                    \u81ea\u52a8\u4f18\u5316\uff08\u5e94\u7528\u4e8e\u81ea\u52a8\u63d0\u53d6\u7684\u63d0\u793a\u8bcd\uff09\n                </label>\n                <div class=\"oair-hint\">\u5173\u95ed\u65f6\uff0c\u4ec5\u5728\u624b\u52a8\u70b9\u51fb\u300c\u4f18\u5316\u63d0\u793a\u8bcd\u300d\u6309\u94ae\u65f6\u751f\u6548\u3002</div>\n            </div>\n\n            <details class=\"oair-details\">\n                <summary>\u4f18\u5316\u63d0\u793a\u8bcd\u6a21\u677f</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_optimize_template\" class=\"text_pole\" rows=\"10\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"\u4f18\u5316\u63d0\u793a\u8bcd\u7684\u6a21\u677f\uff0c\u4f7f\u7528 {{prompt}} \u63d2\u5165\u539f\u59cb\u63d0\u793a\u8bcd\u3002\"></textarea>\n                    <div class=\"oair-hint\">\u4f7f\u7528 {{prompt}} \u63d2\u5165\u539f\u59cb\u63d0\u793a\u8bcd\u3002\u4f18\u5316\u540e\u7684\u63d0\u793a\u8bcd\u5c06\u66ff\u4ee3\u539f\u59cb\u63d0\u793a\u8bcd\u53d1\u9001\u7ed9\u56fe\u7247\u751f\u6210\u540e\u7aef\u3002</div>\n                </div>\n            </details>\n\n            <!-- \u81ea\u5b9a\u4e49\u4f18\u5316 LLM \u540e\u7aef\uff08\u590d\u9009\u6846\u63a7\u5236\u5c55\u5f00\uff09 -->\n            <div style=\"margin-top:10px;\">\n                <label class=\"oair-toggle-label\">\n                    <input id=\"oair_optimize_use_custom\" type=\"checkbox\">\n                    \u4f7f\u7528\u81ea\u5b9a\u4e49\u4f18\u5316 LLM \u540e\u7aef\n                </label>\n                <div class=\"oair-hint\">\u52fe\u9009\u540e\u5c55\u5f00\u81ea\u5b9a\u4e49\u540e\u7aef\u914d\u7f6e\uff0c\u7559\u7a7a\u65f6\u9ed8\u8ba4\u4f7f\u7528\u9152\u9986\u4e3bAPI</div>\n\n                <div class=\"oair-custom-backend-content\" id=\"oair_custom_backend_fields\">\n                    <label class=\"oair-field-label\">\u4f18\u5316 LLM \u670d\u52a1\u5730\u5740</label>\n                    <input id=\"oair_optimize_api_url\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"http://127.0.0.1:11434/v1\">\n                    <div class=\"oair-hint\" data-hint-id=\"optimize_url\">\u81ea\u5b9a\u4e49\u4f18\u5316LLM\u7684\u670d\u52a1\u5730\u5740\uff0c\u586b\u5230 /v1</div>\n\n                    <label class=\"oair-field-label\">\u4f18\u5316 LLM API \u5bc6\u94a5</label>\n                    <div class=\"oair-password-row\">\n                        <input id=\"oair_optimize_api_key\" type=\"password\" class=\"text_pole\" placeholder=\"sk-...\">\n                        <button type=\"button\" class=\"oair-eye-btn\" title=\"\u663e\u793a/\u9690\u85cf\u5bc6\u94a5\"><i class=\"fa-solid fa-eye\"></i></button>\n                    </div>\n                    <div class=\"oair-hint\" data-hint-id=\"optimize_key\">\u81ea\u5b9a\u4e49\u4f18\u5316LLM\u7684API\u5bc6\u94a5</div>\n\n                    <label class=\"oair-field-label\">\u4f18\u5316 LLM \u6a21\u578b</label>\n                    <div class=\"oair-model-row\">\n                        <input id=\"oair_optimize_model\" class=\"text_pole\" placeholder=\"gpt-4o-mini\">\n                        <button id=\"oair_btn_fetch_optimize_model\" class=\"menu_button\">\u83b7\u53d6\u6a21\u578b</button>\n                    </div>\n                    <select id=\"oair_optimize_model_select\" class=\"text_pole\"></select>\n                    <div class=\"oair-hint\" data-hint-id=\"optimize_model\">\u81ea\u5b9a\u4e49\u4f18\u5316LLM\u4f7f\u7528\u7684\u6a21\u578b</div>\n                </div>\n            </div>\n        </div>\n\n        <!-- NSFW \u89c4\u907f -->\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">NSFW \u89c4\u907f <span class=\"oair-badge oair-badge-red\">\u5b89\u5168</span></div>\n            <label class=\"oair-toggle-label\">\n                <input id=\"oair_nsfw_avoidance\" type=\"checkbox\">\n                \u542f\u7528 NSFW \u5185\u5bb9\u89c4\u907f\n            </label>\n            <div class=\"oair-hint\">\n                \u4f7f\u7528 LLM \u81ea\u52a8\u5ba1\u67e5\u63d0\u793a\u8bcd\uff0c\u79fb\u9664\u4e0d\u5b89\u5168\u5185\u5bb9\uff0c\u907f\u514d\u5c01\u53f7\u3002<br>\n                <b>\u5efa\u8bae\u5f00\u542f</b>\uff1a\u5373\u4f7f\u4e3b\u63d0\u793a\u8bcd\u5df2\u8981\u6c42 SFW\uff0c\u6b64\u529f\u80fd\u53ef\u4f5c\u4e3a\u989d\u5916\u5b89\u5168\u7f51\u3002\n            </div>\n\n            <details class=\"oair-details\">\n                <summary>NSFW \u5ba1\u67e5\u6a21\u677f</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_nsfw_avoidance_template\" class=\"text_pole\" rows=\"8\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"NSFW \u5ba1\u67e5\u6a21\u677f\uff0c\u4f7f\u7528 {{prompt}} \u63d2\u5165\u539f\u59cb\u63d0\u793a\u8bcd\u3002\"></textarea>\n                </div>\n            </details>\n        </div>\n\n        <!-- \u6d88\u606f\u603b\u7ed3\u6a21\u677f -->\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u6d88\u606f\u603b\u7ed3\u6a21\u677f</div>\n            <details class=\"oair-details\">\n                <summary>\u5c06\u804a\u5929\u6d88\u606f\u8f6c\u5316\u4e3a\u751f\u56fe\u63d0\u793a\u8bcd\u7684\u6a21\u677f</summary>\n                <div class=\"oair-details-content\">\n                    <textarea id=\"oair_summarize_template\" class=\"text_pole\" rows=\"8\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"\u4f7f\u7528 {{message}} \u63d2\u5165\u6d88\u606f\u5185\u5bb9\u3002\"></textarea>\n                    <div class=\"oair-hint\">\u70b9\u51fb\u6d88\u606f\u4e0a\u7684\u300c\u603b\u7ed3\u751f\u56fe\u300d\u6309\u94ae\u65f6\u4f7f\u7528\u6b64\u6a21\u677f\u3002</div>\n                </div>\n            </details>\n        </div>\n    </div>\n\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <!-- TAB 5: \u624b\u52a8\u751f\u56fe                                       -->\n    <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n    <div class=\"oair-tab-panel\" id=\"oair_panel_manual\">\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u624b\u52a8\u751f\u56fe</div>\n            <label class=\"oair-field-label\">\u8f93\u5165\u63d0\u793a\u8bcd</label>\n            <textarea id=\"oair_manual_prompt\" class=\"text_pole\" rows=\"4\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"\u63cf\u8ff0\u4f60\u60f3\u751f\u6210\u7684\u56fe\u7247...\"></textarea>\n\n            <!-- \u4f18\u5316\u540e\u63d0\u793a\u8bcd\u5c55\u793a\u533a -->\n            <div id=\"oair_manual_optimized_prompt\" style=\"display:none;\">\n                <label class=\"oair-field-label\" style=\"color:#60ff90;\">\u2728 \u4f18\u5316\u540e\u7684\u63d0\u793a\u8bcd</label>\n                <div id=\"oair_manual_optimized_text\" class=\"oair-optimized-box\"></div>\n                <div class=\"oair-hint\" style=\"color:#60ff90;\">\u751f\u6210\u56fe\u7247\u65f6\u5c06\u4f7f\u7528\u6b64\u4f18\u5316\u7248\u672c</div>\n            </div>\n\n            <div class=\"oair-btn-row\">\n                <button id=\"oair_btn_import_msg\" class=\"menu_button\" style=\"flex:1; justify-content:center;\">\n                    \ud83d\udce5 \u5bfc\u5165\u6d88\u606f\n                </button>\n                <button id=\"oair_btn_optimize\" class=\"menu_button\" style=\"flex:1; justify-content:center;\">\n                    \u2728 \u4f18\u5316\u63d0\u793a\u8bcd\n                </button>\n                <button id=\"oair_btn_manual_gen\" class=\"menu_button\" style=\"flex:1; justify-content:center;\">\n                    \ud83c\udfa8 \u751f\u6210\u56fe\u7247\n                </button>\n            </div>\n\n            <div class=\"oair-btn-row\">\n                <button id=\"oair_btn_clear_manual\" class=\"menu_button\" style=\"flex:1; justify-content:center;\">\n                    \u6e05\u7a7a\n                </button>\n                <button id=\"oair_btn_attach\" class=\"menu_button\" style=\"flex:1; justify-content:center;\">\n                    \ud83d\udcce \u9644\u52a0\u5230\u6d88\u606f\n                </button>\n            </div>\n\n            <div class=\"oair-hint\" style=\"margin-top:4px;\">\n                \ud83d\udce5 \u5bfc\u5165\u6d88\u606f\uff1a\u5c06\u5f53\u524d\u804a\u5929\u6700\u540e\u4e00\u6761\u6d88\u606f\u5bfc\u5165\u4e3a\u63d0\u793a\u8bcd\n            </div>\n            <div class=\"oair-hint\">\n                \ud83d\udca1 \u63d0\u793a\uff1a\u5148\u8f93\u5165\u63d0\u793a\u8bcd \u2192 \u70b9\u51fb\u300c\u4f18\u5316\u63d0\u793a\u8bcd\u300d\u67e5\u770b\u4f18\u5316\u6548\u679c \u2192 \u70b9\u51fb\u300c\u751f\u6210\u56fe\u7247\u300d\n            </div>\n        </div>\n\n        <div class=\"oair-section\">\n            <div class=\"oair-section-title\">\u9884\u89c8</div>\n            <div id=\"oair_manual_preview\" style=\"display:grid; gap:8px;\"></div>\n        </div>\n    </div>\n</div>\n";

/**
 * 加载完整设置 HTML 到悬浮窗 body，并初始化绑定和默认标签
 */
function loadFullSettings(body, html) {
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
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: INITIALIZATION & EVENT WIRING
// ═══════════════════════════════════════════════════════════════

$(function () {
    (async function () {
        ensureSettings();
        applyMainPromptInjection();
        loadStylesheet();

        // Poll for #extensions_settings and inject the minimal panel
        let panelInjecting = false;
        const panelPollTimer = setInterval(() => {
            if ($("#oair_ui_drawer").length > 0 || panelInjecting) {
                return;
            }

            const container = $("#extensions_settings");
            if (container.length > 0) {
                panelInjecting = true;
                injectPanelUi(container).finally(() => {
                    panelInjecting = false;
                    // 面板注入成功后停止轮询，避免持续浪费资源
                    if ($("#oair_ui_drawer").length > 0) {
                        clearInterval(panelPollTimer);
                    }
                });
            }
        }, 1000);

        // If FAB is enabled, create it on startup
        if (extension_settings[extensionName].fabEnabled) {
            createFab();
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.MESSAGE_RENDERED, onMessageRendered);

        // 聊天切换时清理 inFlightMessages，避免旧聊天的 key 残留
        eventSource.on(event_types.CHAT_CHANGED, () => {
            inFlightMessages.clear();
        });
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
        console.warn(`[${extensionName}] Failed to load settings_panel.html, using inline fallback`);
        htmlContent = SETTINGS_PANEL_HTML;
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

    // Open floating config button — 直绑 + 事件委托双保险
    $("#oair_btn_open_floating").off("click").on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[${extensionName}] "打开详细配置" button clicked (direct bind)`);
        toggleFloatingPanel();
    });

    // 事件委托后备：防止直绑因 DOM 重建丢失
    $(document).off("click.oair_open_floating").on("click.oair_open_floating", "#oair_btn_open_floating", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[${extensionName}] "打开详细配置" button clicked (delegated)`);
        toggleFloatingPanel();
    });

    console.log(`[${extensionName}] Panel events bound`);
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
                // 同步悬浮窗内的 FAB 开关状态
                if ($("#oair_floating_panel").hasClass("oair-floating--visible")) {
                    updateFloatingUi();
                }
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

async function createFloatingPanel() {
    if ($("#oair_floating_panel").length) return;

    const panel = $(`
        <div id="oair_floating_panel" style="min-height:460px; height:auto; position:fixed; z-index:3000; overflow:hidden; flex-direction:column;">
            <div class="oair-floating-header">
                <h3>🖼️ 图片中继 - 详细配置</h3>
                <button class="oair-floating-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="oair-floating-body"></div>
        </div>
    `);

    // Default position: centered on screen (responsive)
    const isMobile = window.innerWidth <= 1000;
    if (isMobile) {
        // Mobile: CSS handles centering via left:50% + transform, JS only sets vertical position
        panel.css({
            top: Math.max(20, (window.innerHeight * 0.2)),
            left: "50%",
            transform: "translateX(-50%)",
        });
    } else {
        // Desktop: manual centering based on panel width
        const panelWidth = 640;
        panel.css({
            top: Math.max(40, (window.innerHeight - 520) / 2),
            left: Math.max(10, (window.innerWidth - panelWidth) / 2),
        });
    }

    panel.appendTo("body");

    // Load settings_full.html content into the body
    const body = panel.find(".oair-floating-body");

    // 先尝试从文件加载，失败则回退到内联 HTML
    // 这样避免了双重加载导致的闪烁和事件重复绑定
    try {
        const html = await $.get(`${extensionFolderPath}/settings_full.html`);
        loadFullSettings(body, html);
    } catch {
        console.log(`[${extensionName}] Using inline settings HTML (file load failed)`);
        loadFullSettings(body, SETTINGS_FULL_HTML);
    }

    // Draggable via header (mouse + touch)
    let headerDragging = false;
    let headerStartX, headerStartY, panelOrigLeft, panelOrigTop;

    function startDrag(clientX, clientY) {
        headerDragging = true;
        headerStartX = clientX;
        headerStartY = clientY;
        const pos = panel.offset();
        panelOrigLeft = pos.left;
        panelOrigTop = pos.top;
        // Remove CSS centering transform when user starts dragging
        panel.css("transform", "none");
    }

    function moveDrag(clientX, clientY) {
        if (!headerDragging) return;
        panel.css({
            left: panelOrigLeft + (clientX - headerStartX),
            top: panelOrigTop + (clientY - headerStartY),
        });
    }

    function endDrag() {
        headerDragging = false;
    }

    // Mouse events
    panel.find(".oair-floating-header").on("mousedown", function (e) {
        if ($(e.target).closest(".oair-floating-close").length) return;
        startDrag(e.clientX, e.clientY);
        e.preventDefault();
    });

    $(document).on("mousemove.oair_floating", function (e) {
        moveDrag(e.clientX, e.clientY);
    });

    $(document).on("mouseup.oair_floating", function () {
        endDrag();
    });

    // Touch events
    panel.find(".oair-floating-header").on("touchstart", function (e) {
        if ($(e.target).closest(".oair-floating-close").length) return;
        const touch = e.originalEvent?.touches?.[0];
        if (!touch) return;
        startDrag(touch.clientX, touch.clientY);
        e.preventDefault();
    }, { passive: false });

    $(document).on("touchmove.oair_floating", function (e) {
        if (!headerDragging) return;
        const touch = e.originalEvent?.touches?.[0];
        if (!touch) return;
        moveDrag(touch.clientX, touch.clientY);
        e.preventDefault();
    }, { passive: false });

    $(document).on("touchend.oair_floating touchcancel.oair_floating", function () {
        endDrag();
    });

    // Close button
    panel.find(".oair-floating-close").on("click", () => closeFloatingPanel());

    // ESC key to close
    $(document).on("keydown.oair_floating", function (e) {
        if (e.key === "Escape" && panel.hasClass("oair-floating--visible")) {
            closeFloatingPanel();
        }
    });

    console.log(`[${extensionName}] Floating panel created`);
}

function closeFloatingPanel() {
    const panel = $("#oair_floating_panel");
    if (!panel.length) return;

    panel.removeClass("oair-floating--visible");

    // 清除 toggleFloatingPanel 添加的内联样式，让 CSS 接管
    panel.css({
        display: "",
        visibility: "",
        minHeight: "",
        height: "",
    });

    // Clean up document-level event handlers (mouse + touch + keyboard)
    $(document).off("mousemove.oair_floating mouseup.oair_floating touchmove.oair_floating touchend.oair_floating touchcancel.oair_floating keydown.oair_floating");

    // Sync panel UI when closing (in case enabled/fabEnabled changed in floating window)
    updatePanelUi();

    console.log(`[${extensionName}] Floating panel closed`);
}

function toggleFloatingPanel() {
    const panel = $("#oair_floating_panel");

    if (!panel.length) {
        // Create the panel lazily — 内容已同步加载，直接显示
        createFloatingPanel();
        const newPanel = $("#oair_floating_panel");
        newPanel.addClass("oair-floating--visible");

        // 强制保障面板可见性和高度（防止 SillyTavern 主题 CSS 覆盖）
        newPanel.css({
            display: "flex",
            visibility: "visible",
            minHeight: "460px",
            height: "auto",
        });

        // 强制浏览器重绘
        void newPanel[0]?.offsetHeight;

        // 调试日志：输出面板实际尺寸
        const rect = newPanel[0]?.getBoundingClientRect();
        console.log(`[${extensionName}] Panel shown: ${rect?.width}x${rect?.height} at (${rect?.left},${rect?.top})`);
        return;
    }

    if (panel.hasClass("oair-floating--visible")) {
        closeFloatingPanel();
    } else {
        // Rebind document-level handlers (mouse + touch)
        let headerDragging = false;
        let headerStartX, headerStartY, panelOrigLeft, panelOrigTop;

        function rebindStartDrag(clientX, clientY) {
            headerDragging = true;
            headerStartX = clientX;
            headerStartY = clientY;
            const pos = panel.offset();
            panelOrigLeft = pos.left;
            panelOrigTop = pos.top;
            panel.css("transform", "none");
        }

        function rebindMoveDrag(clientX, clientY) {
            if (!headerDragging) return;
            panel.css({
                left: panelOrigLeft + (clientX - headerStartX),
                top: panelOrigTop + (clientY - headerStartY),
            });
        }

        // Mouse events
        panel.find(".oair-floating-header").off("mousedown").on("mousedown", function (e) {
            if ($(e.target).closest(".oair-floating-close").length) return;
            rebindStartDrag(e.clientX, e.clientY);
            e.preventDefault();
        });

        $(document).off("mousemove.oair_floating mouseup.oair_floating touchmove.oair_floating touchend.oair_floating touchcancel.oair_floating keydown.oair_floating");

        $(document).on("mousemove.oair_floating", function (e) {
            rebindMoveDrag(e.clientX, e.clientY);
        });

        $(document).on("mouseup.oair_floating", function () {
            headerDragging = false;
        });

        // Touch events
        panel.find(".oair-floating-header").off("touchstart").on("touchstart", function (e) {
            if ($(e.target).closest(".oair-floating-close").length) return;
            const touch = e.originalEvent?.touches?.[0];
            if (!touch) return;
            rebindStartDrag(touch.clientX, touch.clientY);
            e.preventDefault();
        }, { passive: false });

        $(document).on("touchmove.oair_floating", function (e) {
            if (!headerDragging) return;
            const touch = e.originalEvent?.touches?.[0];
            if (!touch) return;
            rebindMoveDrag(touch.clientX, touch.clientY);
            e.preventDefault();
        }, { passive: false });

        $(document).on("touchend.oair_floating touchcancel.oair_floating", function () {
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

        // 强制保障面板可见性和高度
        panel.css({
            display: "flex",
            visibility: "visible",
            minHeight: "460px",
            height: "auto",
        });

        // 强制浏览器重绘
        void panel[0]?.offsetHeight;

        // 调试日志
        const rect = panel[0]?.getBoundingClientRect();
        console.log(`[${extensionName}] Panel shown: ${rect?.width}x${rect?.height} at (${rect?.left},${rect?.top})`);
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

    // 自定义优化LLM后端复选框
    bindSettingInput("#oair_optimize_use_custom", "optimizeUseCustom", () => fp.find("#oair_optimize_use_custom").prop("checked"));
    fp.find("#oair_optimize_use_custom").off("change.oair_toggle").on("change.oair_toggle", function () {
        const isChecked = $(this).prop("checked");
        fp.find("#oair_custom_backend_fields").toggleClass("oair-visible", isChecked);
        extension_settings[extensionName].optimizeUseCustom = isChecked;
        saveSettingsDebounced();
    });

    bindSettingInput("#oair_optimize_api_url", "optimizeApiUrl", () => fp.find("#oair_optimize_api_url").val());
    bindSettingInput("#oair_optimize_model", "optimizeModel", () => fp.find("#oair_optimize_model").val());
    bindSettingInput("#oair_optimize_api_key", "optimizeApiKey", () => fp.find("#oair_optimize_api_key").val());

    // 获取自定义优化LLM模型列表按钮
    fp.find("#oair_btn_fetch_optimize_model").off("click").on("click", async (e) => {
        e.preventDefault();
        const btn = fp.find("#oair_btn_fetch_optimize_model");
        const origText = btn.text();
        btn.text("获取中...").prop("disabled", true);
        try {
            const models = await fetchOptimizeModelList();
            const select = fp.find("#oair_optimize_model_select");
            select.empty();
            select.append('<option value="">-- 选择模型 --</option>');
            for (const m of models) {
                const opt = $("<option>").val(m).text(m);
                select.append(opt);
            }
            select.addClass("oair-visible");
            // 选择模型时更新输入框
            select.off("change").on("change", function () {
                const val = $(this).val();
                if (val) {
                    fp.find("#oair_optimize_model").val(val);
                    extension_settings[extensionName].optimizeModel = val;
                    saveSettingsDebounced();
                }
            });
            toastr.success(`获取到 ${models.length} 个模型`);
        } catch (err) {
            toastr.error(`获取模型失败: ${err.message}`);
        } finally {
            btn.text(origText).prop("disabled", false);
        }
    });

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

    // 编辑提示词后清除上一次的优化结果，避免「生成图片」误用旧的优化版本
    fp.find("#oair_manual_prompt").off("input.oair_manual").on("input.oair_manual", () => {
        const box = fp.find("#oair_manual_optimized_prompt");
        if (box.is(":visible")) {
            box.hide();
            fp.find("#oair_manual_optimized_text").text("");
            setStatus("提示词已修改，已清除旧的优化结果");
        }
    });

    // ─── 导入消息 ──────────────────────────────────────────
    fp.find("#oair_btn_import_msg").off("click").on("click", async (e) => {
        e.preventDefault();
        const context = getContext();
        const chat = context?.chat;
        if (!chat || chat.length === 0) {
            toastr.warning("当前没有聊天消息可导入");
            return;
        }
        // 找最后一条用户消息
        let lastMsg = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user) {
                lastMsg = chat[i];
                break;
            }
        }
        if (!lastMsg) {
            // 如果没有用户消息，取最后一条消息
            lastMsg = chat[chat.length - 1];
        }
        const text = lastMsg.mes || lastMsg.content || "";
        if (!text.trim()) {
            toastr.warning("消息内容为空");
            return;
        }
        fp.find("#oair_manual_prompt").val(text);
        // 清除之前的优化结果
        fp.find("#oair_manual_optimized_prompt").hide();
        fp.find("#oair_manual_optimized_text").text("");
        toastr.success("已导入消息内容");
    });

    // ─── 附加到消息 ──────────────────────────────────────
    fp.find("#oair_btn_attach").off("click").on("click", async (e) => {
        e.preventDefault();
        const context = getContext();
        const chat = context?.chat;
        if (!chat || chat.length === 0) {
            toastr.warning("当前没有聊天消息");
            return;
        }
        // 获取手动生图的预览图片
        const previewImgs = [];
        fp.find("#oair_manual_preview img").each(function () {
            const src = $(this).attr("src");
            if (src) previewImgs.push(src);
        });
        if (previewImgs.length === 0) {
            toastr.warning("没有已生成的图片可附加，请先生成图片");
            return;
        }
        // 附加到最后一条助手消息（而非任意最后一条消息）
        let lastAssistantMsg = null;
        let lastAssistantIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && !chat[i].is_system) {
                lastAssistantMsg = chat[i];
                lastAssistantIdx = i;
                break;
            }
        }
        if (!lastAssistantMsg) {
            // 回退：如果没有助手消息，取最后一条消息
            lastAssistantIdx = chat.length - 1;
            lastAssistantMsg = chat[lastAssistantIdx];
        }
        attachGeneratedImages(lastAssistantMsg, previewImgs, ["手动生图"]);
        // 重新渲染该消息，否则图片只写入数据、刷新前不可见
        updateMessageBlock(lastAssistantIdx, lastAssistantMsg);
        try { await context.saveChat(); } catch (_) {}
        toastr.success(`已附加 ${previewImgs.length} 张图片到消息`);
    });

    // ─── 获取模型按钮 ──────────────────────────────────────
    fp.find("#oair_btn_fetch_model").off("click").on("click", async (e) => {
        e.preventDefault();
        const btn = fp.find("#oair_btn_fetch_model");
        const origText = btn.text();
        btn.text("获取中...").prop("disabled", true);
        try {
            const models = await fetchModelList();
            const select = fp.find("#oair_model_select");
            select.empty();
            select.append('<option value="">-- 选择模型 --</option>');
            for (const m of models) {
                const opt = $("<option>").val(m).text(m);
                select.append(opt);
            }
            select.addClass("oair-visible");
            // 选择模型时更新输入框
            select.off("change").on("change", function () {
                const val = $(this).val();
                if (val) {
                    fp.find("#oair_model").val(val);
                    extension_settings[extensionName].model = val;
                    saveSettingsDebounced();
                }
            });
            toastr.success(`获取到 ${models.length} 个模型`);
        } catch (err) {
            toastr.error(`获取模型失败: ${err.message}`);
        } finally {
            btn.text(origText).prop("disabled", false);
        }
    });

    // ─── 保存API设置按钮 ──────────────────────────────────
    fp.find("#oair_btn_save_api").off("click").on("click", (e) => {
        e.preventDefault();
        // 强制保存当前所有后端设置
        const s = extension_settings[extensionName];
        s.serviceUrl = fp.find("#oair_service_url").val();
        s.apiKey = fp.find("#oair_api_key").val();
        s.model = fp.find("#oair_model").val();
        s.timeoutMs = Number(fp.find("#oair_timeout_ms").val()) || defaultSettings.timeoutMs;
        s.apiMode = fp.find("#oair_api_mode").val();
        saveSettingsDebounced();
        toastr.success("API 设置已保存");
    });

    // ─── 一键 chatgpt2api 预设 ─────────────────────────────
    fp.find("#oair_btn_chatgpt2api_preset").off("click").on("click", (e) => {
        e.preventDefault();
        const s = extension_settings[extensionName];
        // 服务地址：仅在为空或仍是出厂默认（universal-web-api）时替换为 chatgpt2api 默认地址，
        // 避免覆盖用户已自定义的地址。
        const url = String(s.serviceUrl || "").trim();
        if (!url || url === defaultSettings.serviceUrl) {
            s.serviceUrl = "http://127.0.0.1:3000/v1";
        }
        s.apiMode = "images";                  // images 链路最稳（无需"图片意图"判定）
        s.model = "gpt-image-2";               // chatgpt2api 推荐模型
        s.imageResponseFormat = "b64_json";    // 自包含，必定可渲染
        s.imageCount = Number(s.imageCount) || 1;
        s.imagesPromptTemplate = "{{prompt}}"; // 直通，不污染画图提示词
        s.promptTemplate = "{{prompt}}";       // 若改用 chat 模式也保持干净
        s.optimizeUseCustom = false;           // 文本步骤走酒馆主聊天模型
        s.timeoutMs = 600000;                  // chatgpt2api 生图慢（实测 >3 分钟），120s 默认会超时收不到图
        saveSettingsDebounced();
        updateFloatingUi();                    // 刷新字段 + 切换 images/chat 字段可见性
        setStatus("已应用 chatgpt2api 预设", "success");
        toastr.success("已应用 chatgpt2api 预设：Images 模式 / gpt-image-2 / b64_json / 超时 600s。请确认服务地址与 API 密钥。");
    });

    // ─── 密码眼睛按钮 ──────────────────────────────────────
    fp.find(".oair-eye-btn").off("click").on("click", function () {
        const input = $(this).siblings("input");
        const icon = $(this).find("i");
        if (input.attr("type") === "password") {
            input.attr("type", "text");
            icon.removeClass("fa-eye").addClass("fa-eye-slash");
        } else {
            input.attr("type", "password");
            icon.removeClass("fa-eye-slash").addClass("fa-eye");
        }
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
    fp.find("#oair_optimize_use_custom").prop("checked", !!s.optimizeUseCustom);
    fp.find("#oair_custom_backend_fields").toggleClass("oair-visible", !!s.optimizeUseCustom);
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
    const useCustom = !!settings.optimizeUseCustom;
    const customUrl = String(settings.optimizeApiUrl || "").trim();

    // 路径 1：用户显式配置了自定义文本 LLM 后端 → 直接 POST .../chat/completions
    if (useCustom && customUrl) {
        return callCustomLlmBackend(systemPrompt, userPrompt);
    }

    // 路径 2（默认）：走 SillyTavern 主聊天模型。
    // 经由酒馆自身的后端代理发起，无需知道主 API 的真实地址，也不受浏览器跨域限制。
    // 切记不要回退到「图片生成后端」来做文本优化——纯生图后端（如 chatgpt2api）只会返回图片而非文本。
    const viaMain = await callMainLlm(systemPrompt, userPrompt);
    if (viaMain != null) {
        return String(viaMain).trim();
    }

    throw new Error("无法调用文本模型：请确认 SillyTavern 已连接可用的聊天 API，或在「优化」标签勾选并填写自定义优化后端。");
}

/**
 * 通过酒馆主模型生成纯文本（用于优化 / NSFW 安全审查 / 消息总结）。
 * generateRaw 不带聊天上下文，最适合"输入提示词→输出文本"的转换。
 * 兼容新版对象参数签名与旧版位置参数签名；generateRaw 不可用时返回 null。
 */
async function callMainLlm(systemPrompt, userPrompt) {
    const context = getContext();
    const generateRaw = context?.generateRaw;
    if (typeof generateRaw !== "function") {
        return null;
    }

    // 新版酒馆：generateRaw({ prompt, systemPrompt, ... })，唯一形参带默认值 → length 为 0
    if (generateRaw.length === 0) {
        return await generateRaw({ prompt: userPrompt, systemPrompt });
    }

    // 旧版酒馆：位置参数 generateRaw(prompt, api, instructOverride, quietToLoud, systemPrompt)
    return await generateRaw(userPrompt, null, false, false, systemPrompt);
}

/**
 * 调用用户自定义的文本 LLM 后端（OpenAI 兼容 /chat/completions）。
 */
async function callCustomLlmBackend(systemPrompt, userPrompt) {
    const settings = extension_settings[extensionName];
    const endpoint = resolveEndpoint(settings.optimizeApiUrl, "chat");
    const model = String(settings.optimizeModel || "").trim() || String(settings.model || "");
    const apiKey = String(settings.optimizeApiKey || "").trim() || String(settings.apiKey || "");

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

    return extractContentFromPayload(parseBackendPayload(responseText)).trim();
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
        // chatgpt2api 等"生图聊天"后端据此判定走图片生成链路（否则会走不稳定的文本链路、不返回图片）。
        // 普通 OpenAI 兼容后端通常忽略该字段。放在展开之前，可用「额外请求体 JSON」覆盖。
        modalities: ["image"],
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

            // 注意：部分后端（如 chatgpt2api 的 b64_json 模式）会对同一张图同时返回 url 和 b64_json，
            // 二者指向同一张图片。这里二选一（优先自包含的 b64_json），避免同图重复出现。
            if (item.b64_json) {
                const fmt = String(item.format || "png").toLowerCase();
                images.push(`data:image/${fmt};base64,${item.b64_json}`);
            } else if (item.url) {
                images.push(item.url);
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
        try { await context.saveChat(); } catch (e) { console.warn(`[${extensionName}] saveChat failed`, e); }
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

        // 运行完整提示词处理流水线（优化 + NSFW安全审查）
        // 如果已有手动优化结果，forceOptimize=false 跳过再次自动优化
        prompt = await processPromptPipeline(prompt, { forceOptimize: !optimizedText });

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
            try { await context.saveChat(); } catch (e) { console.warn(`[${extensionName}] saveChat failed`, e); }
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
            try { await context.saveChat(); } catch (e) { console.warn(`[${extensionName}] saveChat failed`, e); }
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

    // 优先处理结构化图片字段
    const structuredSources = [
        data?.media,
        data?.choices?.[0]?.message?.media,
        data?.images,
        data?.choices?.[0]?.message?.images,
    ];

    for (const source of structuredSources) {
        collectStructuredImages(source, endpoint, collected);
    }

    // 处理多模态 content 数组中的 image_url 类型项（GPT-4V 风格响应）
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
        for (const item of content) {
            if (item?.type === "image_url" && item?.image_url?.url) {
                pushImageCandidate(item.image_url.url, endpoint, collected);
            }
            // 兼容其他可能的图片类型结构
            collectStructuredImages(item, endpoint, collected);
        }
    }

    // 从文本内容中提取图片（Markdown链接、宽松URL等）
    const textContent = extractContentFromPayload(data);
    if (textContent) {
        const customRegex = safeParseRegex(responseImageRegexSetting);
        if (customRegex) {
            collectImagesFromText(textContent, customRegex, endpoint, collected);
        }

        collectImagesFromText(textContent, markdownImageRegex(), endpoint, collected);
        collectImagesFromText(textContent, looseImageUrlRegex(), endpoint, collected);
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

    return looseImageUrlRegex().test(text);
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
        Math.min(30000, Number(settings.timeoutMs) || defaultSettings.timeoutMs),
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

/**
 * 获取自定义优化LLM后端的模型列表
 */
async function fetchOptimizeModelList() {
    const settings = extension_settings[extensionName];
    const serviceUrl = String(settings.optimizeApiUrl || "").trim();
    const apiKey = String(settings.optimizeApiKey || "").trim();

    if (!serviceUrl) {
        throw new Error("请先填写优化 LLM 服务地址");
    }

    const endpoint = resolveEndpoint(serviceUrl, "models");

    const headers = {};
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        { method: "GET", headers },
        Math.min(30000, Number(settings.timeoutMs) || defaultSettings.timeoutMs),
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
