// ═══════════════════════════════════════════════════════════════
// ST-OpenAI-Image-Relay — Enhanced Version (Plan C: Hybrid UI)
// SillyTavern 第三方扩展：AI 图片生成中继
// ═══════════════════════════════════════════════════════════════

import { extension_settings, getContext } from "../../../extensions.js";
import {
    BUILT_IN_STYLE_PRESETS,
    applyAutomaticVisualExtraction,
    canUsePolicySafeRetry,
    classifyImageGenerationError,
    compileImagePrompt,
    confirmCharacterCandidatesIntoScope,
    createChatVisualScopeKey,
    createPolicySafeRetryPrompt,
    formatBuiltInStyleLibrary,
    loadChatVisualScope,
    mergeBuiltInStylePresets,
    normalizeVisualExtractionSettings,
    normalizePromptSafetyLevel,
    planSingleImageTarget,
    resolvePersonaVisualCandidates,
    resolveChatVisualBible,
    saveChatVisualScopePatch,
} from "./prompt_compiler.mjs";
import {
    acceptRefinementCandidate,
    classifyPromptRisks,
    createPolicyRetryPromptFromDraft,
    createPromptDraftForJob,
    rewriteRiskyPromptFields,
    validatePromptCandidate,
} from "./prompt_preflight.mjs";
import {
    eventSource,
    event_types,
    name1,
    saveSettingsDebounced,
    updateMessageBlock,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from "../../../../script.js";
import { regexFromString, saveBase64AsFile } from "../../../utils.js";

// ═══════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

const extensionName = "ST-OpenAI-Image-Relay";
const CHAT_VISUAL_META_KEY = `${extensionName}:chatVisualScopes`;
const CHAT_VISUAL_FIELDS = ["characterAppearance", "styleLibrary", "styleActive", "sceneLibrary", "sceneActive", "confirmedCharacters"];

let chatVisualMetadataSaveTimer = null;

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

// 旧版主模型标签注入字段仅保留为空迁移占位，运行时不再读取或注入。
const DEFAULT_MAIN_PROMPT = "";

const DEFAULT_OPTIMIZE_TEMPLATE = [
    '你是一个图片提示词精修编辑。输入内容已经由本地提示词编译器整理为可生图 prompt；你的任务是做轻量精修，而不是重新规划画面。',
    '',
    '【取景策略】：',
    '{{singleStrategy}}',
    '',
    '【固定风格参考】：',
    '{{style}}',
    '',
    '【固定人物外貌参考】：',
    '{{characters}}',
    '',
    '【固定场景参考】：',
    '{{scenes}}',
    '',
    '【编译后提示词】：',
    '{{prompt}}',
    '',
    '精修要求：',
    '1. 保留编译器选定的主体、视觉瞬间、人物关系、镜头构图、场景光影、视觉锚点、连续性和文字/对白策略。',
    '2. 出现具名角色时，必须保留【固定人物外貌参考】里的角色名和关键外貌，不要改写成“少女”“男子”等泛称。',
    '3. 只压缩重复、补足图像模型需要的构图/光线/动作清晰度；不要凭空新增角色、改地点、改剧情顺序或改成多张图。',
    '4. 插件气泡模式下，不要要求模型在图中生成文字；模型画字模式下才保留文字绘制要求。',
    '5. 不要主动把安全的动作戏、武器持握、奇幻道具、追逐、对峙改成日常立绘；最终安全处理由安全重写模板负责。',
    '6. 输出最终生图提示词即可，可保留原来的分段结构；不要前言、解释、项目符号、代码块或额外段落。',
].join('\n');

const DEFAULT_SINGLE_IMAGE_STRATEGY = "climax";
const SINGLE_IMAGE_STRATEGY_LABELS = {
    climax: "剧情高潮：选择本段最有视觉冲击、最能代表剧情转折的瞬间。",
    poster: "总结海报：把整段剧情的主要人物、场景、道具和氛围汇总成代表性画面。",
    final: "最后镜头：优先描绘文本末尾正在发生的当前画面。",
};

const DEFAULT_STYLE_LIBRARY = [
    '日系动画：清爽二次元线条，干净上色，角色表情明确，适合轻小说、动画截图感画面。',
    '写实电影：真实摄影质感，电影级构图，自然光影，细节丰富，适合严肃剧情与沉浸式场景。',
    '厚涂奇幻：厚涂笔触，高饱和光影，幻想史诗氛围，适合魔法、战斗、异世界场景。',
    '赛博朋克：霓虹灯光，高对比暗部，未来都市质感，适合电子、机械、夜景与压迫感画面。',
    '水彩插画：柔和水彩晕染，低对比温柔色彩，纸张纹理，适合日常、回忆、抒情画面。',
].join('\n');

const LEGACY_OPTIMIZE_TEMPLATES = [
    [
        '你是一个专业的图片提示词优化专家。请把下列信息整理为【剧情主轴导向】中文单图生图提示词。',
        '',
        '【取景策略】：',
        '{{singleStrategy}}',
        '',
        '【固定风格参考】：',
        '{{style}}',
        '',
        '【固定人物外貌参考】：',
        '{{characters}}',
        '',
        '【固定场景参考】：',
        '{{scenes}}',
        '',
        '【本次场景原文】：',
        '{{prompt}}',
        '',
        '输出格式必须固定为以下七段，标题、冒号和顺序都不能改变：',
        '画面主轴：XXXX',
        '剧情瞬间：XXXX',
        '主要人物：XXXX',
        '空间构图：XXXX',
        '场景氛围：XXXX',
        '关键视觉锚点：XXXX',
        '绘图指令：请根据上述要求绘图',
        '',
        '填写要求：',
        '1. 画面主轴：先判断这张图真正要画什么，必须保护剧情主线，不要只抓最后一句标签或局部人物。',
        '2. 剧情瞬间：按【取景策略】选择剧情高潮、总结海报或最后镜头；长文只能落到一张单图时，必须说明被选中的具体瞬间。',
        '3. 主要人物：列出本画面必须出现的主要人物、身份、外貌、装备、情绪；出现的具名角色必须套用【固定人物外貌参考】中的“角色名：外貌描述”，不得改写成“少女”“男子”等泛称。',
        '4. 空间构图：明确前景、中景、远景、视角、人物之间的位置关系和画面层次。',
        '5. 场景氛围：融合【固定场景参考】和本次原文，只描述地点、环境、时间、光影、天气、人群、建筑、氛围等可视化信息。',
        '6. 关键视觉锚点：保留原文中最能防止失真的道具、文字、标志、特殊光效、背景事件、巨大实体或环境符号。',
        '7. 绘图指令固定写为“请根据上述要求绘图”，不要在此行复述或扩写前六段内容。',
        '8. 若某项信息不足，也要保留该段并写出最合理的安全、可视化描述；不要输出“无”。',
        '9. 只输出七段固定格式，不要前言、解释、项目符号、代码块或额外段落。',
    ].join('\n'),
    [
        '你是一个专业的图片提示词优化专家。请把下列信息整理为【固定五项 + 画图指令】中文生图提示词。',
        '',
        '【固定风格参考】：',
        '{{style}}',
        '',
        '【固定人物外貌参考】：',
        '{{characters}}',
        '',
        '【固定场景参考】：',
        '{{scenes}}',
        '',
        '【本次场景原文】：',
        '{{prompt}}',
        '',
        '输出格式必须固定为以下六行，字段名、冒号和顺序都不能改变：',
        '风格：XXXX',
        '场景：XXXXXX',
        '人物外貌：XXXXXXX',
        '人物空间位置：XXXXXX',
        '人物行为：XXXXXXX',
        '画图指令：XXXXXXX',
        '',
        '填写要求：',
        '1. 风格：优先使用【固定风格参考】，没有固定风格时从原文提炼画风、镜头、光影、色彩。',
        '2. 场景：融合【固定场景参考】和本次原文，只描述本张图发生的地点、环境、时间、氛围。',
        '3. 人物外貌：出现的具名角色必须套用【固定人物外貌参考】中的外貌，不得改写、弱化或省略关键特征。',
        '4. 人物空间位置：明确人物之间、人物与场景物体之间的站位、距离、朝向、前后层次。',
        '5. 人物行为：只描述当前画面中可见的动作、表情、互动和姿态。',
        '6. 画图指令必须是可直接发送给图片模型的完整生图提示词，要把前五行信息整合成一段连贯、具体、可视化的画面描述。',
        '7. 若某项信息不足，也要保留该行并写出最合理的安全、可视化描述；不要输出“无”。',
        '8. 只输出六行固定格式，不要前言、解释、项目符号、代码块或额外段落。',
    ].join('\n'),
    [
        '你是一个专业的图片提示词优化专家。请把下列信息整合成一段可直接用于生成【单张】图片的中文提示词。',
        '',
        '【风格】（固定，必须严格遵循）：',
        '{{style}}',
        '',
        '【人物特征】（固定，出现的角色必须逐字保留以下外貌设定，不得改写或省略）：',
        '{{characters}}',
        '',
        '【场景设定】（固定参考，若本次画面发生在这些地点或环境中，必须保留其关键特征）：',
        '{{scenes}}',
        '',
        '【本次场景原文】：',
        '{{prompt}}',
        '',
        '整合要求：',
        '1. 从场景原文中提炼〔场景环境〕〔人物空间位置〕〔行为动作〕三部分，与上面的风格、人物特征、场景设定融合成统一画面。',
        '2. 若原文含多个场景或时间段，只取最后出现的、或最具视觉冲击力的高潮场景作为画面主体。',
        '3. 出现的具名角色必须套用上面【人物特征】里的固定外貌，严禁替换成「女孩」「男子」等泛称，也不要省略其外观细节。',
        '4. 不要凭空虚构未提供的人物身份或外貌；可补充利于出图的构图、视角、色彩、光线，但不得削弱原文已有关键信息。',
        '5. 使用中文连贯句子描述，而不是关键词堆砌。',
        '6. 只输出最终提示词，不要包含任何解释、前言或后记。',
    ].join('\n'),
    [
        '你是一个专业的图片提示词优化专家。请把下列信息整合成一段可直接用于生成【单张】图片的中文提示词。',
        '',
        '【风格】（固定，必须严格遵循）：',
        '{{style}}',
        '',
        '【人物特征】（固定，出现的角色必须逐字保留以下外貌设定，不得改写或省略）：',
        '{{characters}}',
        '',
        '【本次场景原文】：',
        '{{prompt}}',
        '',
        '整合要求：',
        '1. 从场景原文中提炼〔场景环境〕〔人物空间位置〕〔行为动作〕三部分，与上面的风格、人物特征融合成统一画面。',
        '2. 若原文含多个场景或时间段，只取最后出现的、或最具视觉冲击力的高潮场景作为画面主体。',
        '3. 出现的具名角色必须套用上面【人物特征】里的固定外貌，严禁替换成「女孩」「男子」等泛称，也不要省略其外观细节。',
        '4. 不要凭空虚构未提供的人物身份或外貌；可补充利于出图的构图、视角、色彩、光线，但不得削弱原文已有关键信息。',
        '5. 使用中文连贯句子描述，而不是关键词堆砌。',
        '6. 只输出最终提示词，不要包含任何解释、前言或后记。',
    ].join('\n'),
];

const LEGACY_OPTIMIZE_TEMPLATE_MARKERS = [
    "固定六项 + 简短画图指令",
    "固定五项 + 画图指令",
    "剧情主轴导向",
    "图片提示词优化专家",
];

const LEGACY_NSFW_TEMPLATE_MARKERS = [
    "内容安全审查专家",
    "重度伤害",
    "改为人物立绘、日常场景、风景",
];

const DEFAULT_ANALYSIS_TEMPLATE = [
    '你是图片场景分析助手。阅读【场景原文】后判断三件事：',
    '1. characters：从【候选人物】里挑出本场景实际出场的人物名（数组；没有就空数组）。',
    '2. style：从【候选风格】里挑出最贴合本场景氛围的一个风格名（字符串；无合适就空字符串）。',
    '3. scene：从【候选场景】里挑出最贴合本次画面的一个场景名（字符串；无合适就空字符串）。',
    '',
    '只输出一行紧凑 JSON，不要任何解释或代码块标记，例如：',
    '{"characters":["卡提希娅","齐齐"],"style":"写实","scene":"雨夜街道"}',
    '',
    '【候选人物】：{{characters}}',
    '【候选风格】：{{styles}}',
    '【候选场景】：{{scenes}}',
    '【场景原文】：',
    '{{prompt}}',
].join('\n');

const DEFAULT_NSFW_TEMPLATE = [
    '你是一个图片提示词安全重写专家。请按【安全级别】审查并最小化修改以下图片生成提示词，确保其内容安全（SFW）。',
    '',
    '【安全级别】：{{safetyLevel}}',
    '',
    '级别说明：',
    '- strict：更积极地弱化危险、暴力和性暗示，但仍保留基本画面意图。',
    '- standard：默认级别，只移除明确不安全内容；保留非血腥动作戏、武器持握、奇幻道具、追逐、对峙、紧张气氛和电影感冲突。',
    '- loose：只移除露骨色情、裸露、血腥、肢解、重度伤害等明确违规细节，尽量保留原文张力。',
    '',
    '规则：',
    '1. 必须移除色情、裸露、性行为、露骨身体描写、未成年暧昧、血腥、肢解、内脏、重度伤害等明确不安全内容。',
    '2. 不要把安全的动作戏、奇幻战斗、武器道具、魔法药剂、对峙、闪避、格挡、追逐、紧张氛围改成日常人物立绘或风景。',
    '3. 如需弱化战斗，只把血口、滴血、致命伤、残酷伤害改成非血腥的“擦伤、格挡、击退、踉跄、破绽、火花、尘土、冲击感”。',
    '4. 保持主体、构图、人物关系、道具、场景、镜头和剧情张力。',
    '5. 如果原始提示词已经安全，直接原样返回。',
    '6. 只输出修改后的提示词，不要包含任何解释、标题或代码块。',
    '',
    '原始提示词：',
    '{{prompt}}',
].join('\n');

const DEFAULT_SUMMARIZE_TEMPLATE = [
    '请将以下聊天消息内容转换为一张图片的生成提示词。',
    '',
    '要求：',
    '1. 若消息包含多个场景或时间段，只选取最后出现的、或最具视觉冲击力的高潮场景作为画面主体。',
    '2. 完整保留消息中出现的人物姓名与身份、发型发色、瞳色、体型、服装配饰、指甲妆容、武器道具，以及场景里的关键物件与环境氛围；不要把具名角色替换成「女孩」「男子」等泛称。',
    '3. 将其转化为完整的图片描述，包含构图、光线、氛围等细节',
    '4. 确保内容安全（SFW），避免色情或暴力内容',
    '5. 使用中文连贯句子描述，而不是关键词堆砌',
    '6. 只输出提示词，不要包含解释',
    '',
    '消息内容：',
    '{{message}}',
].join('\n');

const DEFAULT_MULTI_ANALYSIS_TEMPLATE = [
    '你是剧情分镜专家。阅读【剧情原文】后，将其拆分为 {{beatCount}} 个递进的剧情节点（StoryBeat），每个节点代表一个适合生成图片的视觉瞬间。',
    '',
    '输出格式必须是紧凑 JSON（不要代码块标记），结构如下：',
    '{"beats":[',
    '  {"title":"节点1标题","visualMoment":"这一瞬间的视觉画面描述","characters":["角色A","角色B"],"scene":"地点环境","actions":["动作1","动作2"],"anchors":["视觉锚点1","视觉锚点2"]},',
    '  {"title":"节点2标题","visualMoment":"...","characters":[...],"scene":"...","actions":[...],"anchors":[...]},',
    '  ...',
    ']}',
    '',
    '拆分要求：',
    '1. 每个 beat 的 title 简短（5-10字）、visualMoment 具体（完整句子描述该瞬间画面）。',
    '2. characters 数组包含该节点出现的具名角色（名字，不是泛称）。',
    '3. scene 描述该节点发生的地点、环境、时间、氛围（一句话）。',
    '4. actions 数组列出该节点人物的关键可视化动作。',
    '5. anchors 数组列出该节点的关键视觉锚点（道具、背景标志、光影特征等）。',
    '6. 节点按剧情时间递进排序，覆盖【剧情原文】的完整流程。',
    '7. 若原文不足 {{beatCount}} 个明显节点，优先保留关键转折和高潮，可适当合并次要情节；若原文远超 {{beatCount}} 个场景，只取最重要的 {{beatCount}} 个节点。',
    '',
    '【剧情原文】：',
    '{{prompt}}',
].join('\n');

const DEFAULT_COMIC_ANALYSIS_TEMPLATE = [
    '你是漫画分镜师。阅读【剧情原文】后，将其拆分为 {{panelCount}} 格漫画分镜（ComicPanel），每格代表一个可以独立生成图片的画面。',
    '',
    '输出格式必须是紧凑 JSON（不要代码块标记），结构如下：',
    '{"panels":[',
    '  {"index":1,"shotType":"远景/中景/近景/特写","imageDescription":"这一格的完整画面描述","characters":["角色A"],"actions":["动作1"],"dialogue":["角色A：台词内容"],"caption":"旁白文字（无则空字符串）","anchors":["视觉锚点1"]},',
    '  ...',
    ']}',
    '',
    '拆分要求：',
    '1. index 为格号，从 1 开始按阅读顺序递增。',
    '2. shotType 写镜头类型（远景/中景/近景/特写等），相邻格尽量变化镜头制造节奏。',
    '3. imageDescription 用完整中文句子描述该格画面（构图、人物姿态、表情、环境），不包含对白文字本身。',
    '4. characters 数组列出该格出场的具名角色；actions 列出关键可视化动作。',
    '5. dialogue 数组按「角色名：台词」格式记录该格对白；没有对白就用空数组。',
    '6. caption 为该格旁白/场景说明文字，没有就空字符串。',
    '7. anchors 列出该格关键视觉锚点（道具、标志物、光影特征等）。',
    '8. 分镜按剧情时间顺序覆盖【剧情原文】的主线；若原文场景超过 {{panelCount}} 格，只取最重要的 {{panelCount}} 格。',
    '',
    '【剧情原文】：',
    '{{prompt}}',
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
    promptTemplate: "{{prompt}}",
    imagesPromptTemplate: "{{prompt}}",         // images API 模板（默认直通）
    imageSize: "1024x1024",
    imageCount: 1,
    imageResponseFormat: "url",                 // "url" | "b64_json"
    extraBody: "",

    // ─── 提取 ──────────────────────────────────────────────
    extractionRegex: "",
    responseImageRegex: "/!\\[[^\\]]*\\]\\(([^)\\s]+)\\)/g",

    // ─── 优化 ──────────────────────────────────────────────
    promptCompilerEnabled: true,                   // 本地提示词编译器：将计划转换成图像后端友好的 prompt
    optimizeEnabled: false,
    optimizeAuto: false,
    optimizeTemplate: DEFAULT_OPTIMIZE_TEMPLATE,
    singleImageStrategy: DEFAULT_SINGLE_IMAGE_STRATEGY, // 单图取景策略：climax | poster | final
    visualSanitizationLevel: "standard",          // 固定设定清洗强度：strict | standard | loose
    optimizeUseCustom: false,                      // 是否使用自定义精修 LLM 后端
    optimizeApiUrl: "",
    optimizeModel: "",
    optimizeApiKey: "",
    textMaxTokens: 8192,                           // 优化/审查/总结等文本调用的回复上限(max_tokens)；推理模型需较大值，太小会截断思考导致质量低，太大可能被后端拒绝/挂起
    characterAppearance: "",                       // 人物库：每行「名字：外貌」，出场角色的外貌逐字注入编译/精修链路（世界书作补充来源）

    // ─── 世界书注入 ──────────────────────────────────────────
    // worldBookMode: "off" | "inject" | "extract"；legacy worldBookEnabled 继续兼容旧设置。
    worldBookMode: "off",
    characterWorldBookMode: "off",                  // 人物世界书来源：off | inject | extract
    sceneWorldBookMode: "off",                      // 场景世界书来源：off | inject | extract
    worldBookEnabled: false,
    worldBookSectionHeadings: "外貌,长相,外观,appearance,场景,环境,setting,scene",
    worldBookMaxChars: 800,

    // ─── 固定设定（风格库 / 人物库）─────────────────────────
    styleLibrary: "",                              // 风格库：每行「风格名：风格描述」
    styleActive: "",                               // 当前激活（默认固定）的风格名
    styleAutoSelect: false,                        // LLM 按场景自动选风格（覆盖 styleActive）
    characterLlmExtract: false,                    // LLM 智能识别出场人物（默认子串匹配）
    autoExtractCharactersEnabled: false,            // 自动从新 AI 消息提取人物库，只写当前角色卡
    autoExtractScenesEnabled: false,                // 自动从新 AI 消息提取场景库，只写当前角色卡
    sceneLibrary: "",                              // 场景库：每行「场景名：环境/地点描述」
    sceneActive: "",                               // 当前固定场景名
    sceneAutoSelect: false,                        // LLM 按原文自动选场景（覆盖 sceneActive）
    analysisTemplate: DEFAULT_ANALYSIS_TEMPLATE,   // 场景分析调用模板（出人物 + 选风格）

    // ─── 安全重写 ──────────────────────────────────────────
    nsfwAvoidance: false,
    promptSafetyLevel: "standard",                 // strict | standard | loose
    nsfwAvoidanceTemplate: DEFAULT_NSFW_TEMPLATE,

    // ─── 消息生图 ──────────────────────────────────────────
    messageGenEnabled: true,
    summarizeTemplate: DEFAULT_SUMMARIZE_TEMPLATE,
    multiAnalysisTemplate: DEFAULT_MULTI_ANALYSIS_TEMPLATE,

    // ─── 自动整条 AI 消息生图 ───────────────────────────────
    automaticFlowEnabled: false,                 // 自动流程默认关闭，开启后每条新 AI 消息按整条正文生图
    automaticFlowFollowWorkbench: true,          // 本阶段 single 模式沿用当前单图/优化/设定配置
    automaticFlowMinChars: 80,                   // 清洗后正文少于该字数则跳过，避免短回复刷图
    automaticFlowFailurePolicy: "stop",          // single 自动任务默认 fail-fast，保留旧错误提示语义
    automaticFlowShowQueue: true,
    automaticFlowCancelEnabled: true,

    // ─── 多图模式 ──────────────────────────────────────────
    multiImageEnabled: false,                    // 多图模式默认关闭
    defaultBeatCount: 3,                         // 默认生成 3 张多图
    splitStrategy: "auto",                       // auto 或 fixed（本阶段只实现 auto LLM 拆分）
    multiImageFailurePolicy: "continue",         // 多图默认 continue，聚合成功图片

    // ─── 生成模式与漫画模式 ─────────────────────────────────
    generationMode: "single",                    // 手动工作台生成模式：single | multi | comic
    comicPanelCount: 4,                          // 漫画默认分格数（2-8）
    comicDialogueEnabled: true,                  // 是否要求漫画 planner 生成对白/旁白元数据
    comicDialogueMode: "bubble",                 // 对白模式：bubble（插件气泡，默认）| modelText（模型画字）
    comicFailurePolicy: "continue",              // 漫画分格失败策略，默认聚合成功格
    comicAnalysisTemplate: DEFAULT_COMIC_ANALYSIS_TEMPLATE,
    cleanupTemplate: "",                         // 预留：清洗模板集中到提示词模板页

    // ─── 图生图连续性（预留）────────────────────────────────
    // 本阶段仅把参考图记录进 ImageJob.referenceImages 元数据，不改变文生图请求；
    // 编辑接口（如 chatgpt2api 图片编辑端点）接入后才真正按参考图生成。
    continuityMode: "off",                       // off | previous | firstAndPrevious | characterAndPrevious
    imageEditEnabled: false,                     // 预留：图片编辑/图生图能力开关（调研接入后启用）
    imageEditEndpoint: "",                       // 预留：编辑接口地址；为空或不可用时回退文生图

    // ─── UI 控制 ──────────────────────────────────────────
    fabEnabled: false,
    fabPosition: { top: null, left: null },
    floatingDefaultTab: "manual",
};

// ═══════════════════════════════════════════════════════════════
// SECTION 2.5: INLINE HTML TEMPLATES (fallback when $.get fails)
// ═══════════════════════════════════════════════════════════════

const SETTINGS_PANEL_HTML = "<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<!-- \u9762\u677f\u7cbe\u7b80\u7248 \u2014 \u53ea\u4fdd\u7559\u57fa\u7840\u5f00\u5173\u548c\u72b6\u6001 -->\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div class=\"oair-panel-ui\">\n    <!-- \u72b6\u6001\u680f -->\n    <div style=\"display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; gap:8px;\">\n        <div id=\"oair_status\" style=\"font-size:0.8em; color:cyan;\">\u5c31\u7eea</div>\n        <label style=\"display:flex; align-items:center; gap:6px; font-size:0.8em; white-space:nowrap;\">\n            <input id=\"oair_enabled\" type=\"checkbox\">\n            \u542f\u7528\n        </label>\n    </div>\n\n    <!-- \u60ac\u6d6e\u5feb\u6377\u6309\u94ae\u5f00\u5173 -->\n    <div class=\"oair-section\">\n        <label class=\"oair-toggle-label\">\n            <input id=\"oair_fab_enabled\" type=\"checkbox\">\n            \u663e\u793a\u60ac\u6d6e\u5feb\u6377\u6309\u94ae\n        </label>\n        <div class=\"oair-hint\">\n            \u52fe\u9009\u540e\u5c4f\u5e55\u53f3\u4e0b\u89d2\u51fa\u73b0\u53ef\u62d6\u62fd\u7684\u5feb\u6377\u6309\u94ae\uff0c\u70b9\u51fb\u6253\u5f00\u8be6\u7ec6\u914d\u7f6e\u7a97\u53e3\u3002<br>\n            \u9002\u5408\u9700\u8981\u9891\u7e41\u4f7f\u7528\u624b\u52a8\u751f\u56fe\u6216\u8c03\u6574\u914d\u7f6e\u7684\u573a\u666f\u3002\n        </div>\n    </div>\n\n    <!-- \u5feb\u6377\u5165\u53e3 -->\n    <div class=\"oair-section\" style=\"margin-top:4px;\">\n        <button id=\"oair_btn_open_floating\" class=\"menu_button\" style=\"width:100%; justify-content:center;\">\n            \ud83d\uddbc\ufe0f \u6253\u5f00\u8be6\u7ec6\u914d\u7f6e\u7a97\u53e3\n        </button>\n        <div class=\"oair-hint\" style=\"margin-top:4px; text-align:center;\">\n            \u6216\u4f7f\u7528\u60ac\u6d6e\u5feb\u6377\u6309\u94ae\u5feb\u901f\u8bbf\u95ee\n        </div>\n    </div>\n</div>\n";

const SETTINGS_FULL_HTML = "\u003c!-- ═══════════════════════════════════════════════════════ --\u003e\n\u003c!-- 完整配置版 — Huashu 混合型信息架构，用于悬浮窗 --\u003e\n\u003c!-- ═══════════════════════════════════════════════════════ --\u003e\n\u003cstyle\u003e\n    .oair-tabs-container { display:flex; flex-direction:column; gap:0; }\n    .oair-tab-bar { display:flex; gap:4px; border-bottom:1px solid rgba(255,255,255,0.14); margin-bottom:12px; flex-wrap:nowrap; overflow-x:auto; scrollbar-width:thin; padding-bottom:2px; }\n    .oair-tab-radio { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); border:0; white-space:nowrap; }\n    .oair-tab-label { padding:7px 11px; font-size:0.8em; cursor:pointer; border-radius:999px; opacity:0.62; transition:all .16s ease; user-select:none; white-space:nowrap; flex:0 0 auto; letter-spacing:.02em; }\n    .oair-tab-label:hover { opacity:.92; background:rgba(255,255,255,.06); }\n    #oair_tab_workbench:focus-visible ~ .oair-tab-bar label[for=\"oair_tab_workbench\"],\n    #oair_tab_library:focus-visible ~ .oair-tab-bar label[for=\"oair_tab_library\"],\n    #oair_tab_prompts:focus-visible ~ .oair-tab-bar label[for=\"oair_tab_prompts\"],\n    #oair_tab_models:focus-visible ~ .oair-tab-bar label[for=\"oair_tab_models\"],\n    #oair_tab_history:focus-visible ~ .oair-tab-bar label[for=\"oair_tab_history\"] { outline:2px solid rgba(104,160,255,.75); outline-offset:2px; }\n    .oair-tab-panel { display:none; }\n    #oair_tab_workbench:checked ~ .oair-tab-bar label[for=\"oair_tab_workbench\"],\n    #oair_tab_library:checked ~ .oair-tab-bar label[for=\"oair_tab_library\"],\n    #oair_tab_prompts:checked ~ .oair-tab-bar label[for=\"oair_tab_prompts\"],\n    #oair_tab_models:checked ~ .oair-tab-bar label[for=\"oair_tab_models\"],\n    #oair_tab_history:checked ~ .oair-tab-bar label[for=\"oair_tab_history\"] { opacity:1; background:linear-gradient(135deg, rgba(255,216,164,.17), rgba(166,215,255,.13)); border:1px solid rgba(255,255,255,.13); box-shadow:0 0 0 1px rgba(255,255,255,.045) inset; }\n    #oair_tab_workbench:checked ~ #oair_panel_workbench,\n    #oair_tab_library:checked ~ #oair_panel_library,\n    #oair_tab_prompts:checked ~ #oair_panel_prompts,\n    #oair_tab_models:checked ~ #oair_panel_models,\n    #oair_tab_history:checked ~ #oair_panel_history { display:block; }\n    .oair-section { background:linear-gradient(180deg, rgba(255,255,255,.055), rgba(0,0,0,.12)); padding:11px; border-radius:12px; margin-bottom:9px; border:1px solid rgba(255,255,255,.10); box-shadow:0 8px 24px rgba(0,0,0,.12); }\n    .oair-section-title { font-weight:bold; font-size:.9em; margin-bottom:8px; display:flex; align-items:center; gap:7px; letter-spacing:.02em; }\n    .oair-field-label { display:block; font-size:.76em; opacity:.82; margin-top:7px; margin-bottom:3px; }\n    .oair-hint { margin-top:4px; font-size:.72em; opacity:.62; line-height:1.45; }\n    .oair-row { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:7px; }\n    .oair-btn-row { display:flex; gap:7px; margin-top:7px; flex-wrap:wrap; }\n    .oair-btn-row .menu_button { min-height:30px; white-space:nowrap; word-break:keep-all; }\n    .oair-toggle-label { display:flex; align-items:center; gap:6px; font-size:.8em; }\n    .oair-badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:.7em; font-weight:bold; vertical-align:middle; white-space:nowrap; }\n    .oair-badge-green { background:rgba(0,200,100,.18); color:#78ffac; }\n    .oair-badge-orange { background:rgba(255,180,60,.18); color:#ffd08a; }\n    .oair-badge-red { background:rgba(255,80,80,.18); color:#ff9a9a; }\n    .oair-workbench-grid { display:grid; grid-template-columns:minmax(260px, .95fr) minmax(280px, 1.05fr); gap:10px; align-items:start; }\n    .oair-workbench-left,.oair-workbench-right { min-width:0; }\n    .oair-plan-placeholder,.oair-log-box,.oair-history-box { border:1px dashed rgba(255,255,255,.16); border-radius:10px; padding:9px; background:rgba(0,0,0,.10); font-size:.76em; line-height:1.5; opacity:.78; }\n    .oair-character-list,.oair-progress-list,.oair-history-list { display:grid; gap:7px; }\n    .oair-progress-list { max-height:min(34vh, 320px); overflow-y:auto; padding-right:2px; }\n    .oair-character-card,.oair-progress-card,.oair-history-record { border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px; background:rgba(255,255,255,.045); }\n    .oair-character-card-head,.oair-history-record-head { display:flex; align-items:center; justify-content:space-between; gap:7px; font-size:.78em; font-weight:bold; }\n    .oair-character-card-head { justify-content:flex-start; }\n    .oair-character-toggle-btn { margin-left:auto; min-height:24px; padding:2px 8px; font-size:.72em; white-space:nowrap; }\n    .oair-character-source,.oair-history-time,.oair-history-meta,.oair-history-prompt,.oair-history-job,.oair-progress-status { font-size:.73em; opacity:.76; line-height:1.45; overflow-wrap:anywhere; word-break:break-word; }\n    .oair-error-summary { margin-top:6px; max-height:86px; overflow-y:auto; padding:6px; border-radius:6px; background:rgba(255,80,80,.08); color:#ffb3b3; font-size:.72em; line-height:1.45; white-space:pre-wrap; overflow-wrap:anywhere; }\n    .oair-character-candidate-text { margin-top:6px; width:100%; box-sizing:border-box; resize:vertical; }\n    .oair-progress-title { font-size:.78em; font-weight:bold; margin-bottom:4px; }\n    .oair-status-succeeded { color:#78ffac; }\n    .oair-status-failed,.oair-history-error { color:#ff9a9a; }\n    .oair-workbench-preview-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(96px, 1fr)); gap:8px; margin-top:8px; align-items:start; }\n    .oair-preview-card { min-width:0; border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:7px; background:rgba(255,255,255,.045); }\n    .oair-preview-title { margin-bottom:6px; font-size:.74em; line-height:1.35; opacity:.82; overflow-wrap:anywhere; }\n    .oair-preview-thumb { position:relative; overflow:hidden; border-radius:6px; background:rgba(0,0,0,.22); aspect-ratio:1 / 1; }\n    .oair-preview-thumb img { display:block; width:100%; height:100%; object-fit:cover; cursor:pointer; }\n    .oair-preview-card .oair-panel-dialogue { max-height:70px; overflow-y:auto; overflow-wrap:anywhere; }\n    .oair-history-job { display:flex; align-items:center; justify-content:space-between; gap:6px; padding-top:5px; margin-top:5px; border-top:1px solid rgba(255,255,255,.08); }\n    .oair-history-prompt { margin-top:5px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n    .oair-history-empty { padding:10px; border:1px dashed rgba(255,255,255,.16); border-radius:8px; font-size:.76em; opacity:.68; text-align:center; }\n    .oair-auto-flow-events,.oair-built-in-style-list { display:grid; gap:6px; margin-top:8px; max-height:150px; overflow-y:auto; padding-right:2px; }\n    .oair-auto-flow-event,.oair-built-in-style { border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:7px; background:rgba(255,255,255,.045); min-width:0; }\n    .oair-auto-flow-event { display:grid; grid-template-columns:auto 1fr; gap:6px; align-items:start; }\n    .oair-auto-flow-kind { font-size:.68em; font-weight:700; padding:1px 6px; border-radius:999px; background:rgba(104,160,255,.16); white-space:nowrap; }\n    .oair-auto-flow-text,.oair-built-in-style-text { font-size:.73em; line-height:1.45; opacity:.78; overflow-wrap:anywhere; }\n    .oair-built-in-style-name { font-size:.78em; font-weight:700; margin-bottom:3px; }\n    .oair-optimized-box { background:rgba(0,200,100,.08); border:1px solid rgba(0,200,100,.25); border-radius:8px; padding:8px; margin-top:6px; font-size:.85em; line-height:1.5; white-space:pre-wrap; word-break:break-word; }\n    .oair-input-with-btn,.oair-password-row,.oair-model-row,.oair-save-row { display:flex; gap:6px; align-items:center; }\n    .oair-input-with-btn .text_pole,.oair-password-row .text_pole,.oair-model-row .text_pole,.oair-save-row .text_pole { flex:1; min-width:0; }\n    .oair-model-row .menu_button,.oair-save-row .menu_button,#oair_btn_chatgpt2api_preset { flex:0 0 auto; white-space:nowrap; word-break:keep-all; min-width:max-content; }\n    .oair-password-row .oair-eye-btn { flex-shrink:0; width:32px; height:32px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.15); border-radius:4px; color:var(--SmartThemeBodyColor,#ccc); cursor:pointer; font-size:13px; }\n    #oair_model_select,#oair_optimize_model_select { width:100%; margin-top:4px; display:none; }\n    #oair_model_select.oair-visible,#oair_optimize_model_select.oair-visible { display:block; }\n    .oair-details { margin-top:8px; }\n    .oair-details summary { font-size:.78em; cursor:pointer; opacity:.78; padding:4px 0; user-select:none; list-style:none; display:flex; align-items:center; gap:4px; }\n    .oair-details summary::-webkit-details-marker { display:none; }\n    .oair-details summary::before { content:\"▸\"; display:inline-block; width:12px; text-align:center; transition:transform .15s; }\n    .oair-details[open] summary::before { transform:rotate(90deg); }\n    .oair-custom-backend-content { display:none; }\n    .oair-custom-backend-content.oair-visible { display:block; }\n    .oair-library-toolbar { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }\n    .oair-library-toolbar .menu_button { flex:1 1 120px; justify-content:center; min-height:30px; white-space:nowrap; word-break:keep-all; }\n    .oair-library-summary { display:grid; gap:6px; margin-top:8px; }\n    .oair-library-card { border:1px solid rgba(255,255,255,.12); border-radius:8px; padding:8px; background:rgba(255,255,255,.045); }\n    .oair-library-card-title { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:.82em; font-weight:bold; }\n    .oair-library-card-body { margin-top:4px; font-size:.75em; line-height:1.45; opacity:.78; word-break:break-word; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n    .oair-library-empty { padding:10px; border:1px dashed rgba(255,255,255,.18); border-radius:8px; font-size:.76em; opacity:.65; text-align:center; }\n    .oair-active-chip { display:inline-flex; align-items:center; padding:2px 7px; border-radius:999px; background:rgba(104,160,255,.16); font-size:.72em; font-weight:normal; white-space:nowrap; }\n    .oair-radio-group { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; margin-top:8px; }\n    .oair-radio-option { display:flex; align-items:flex-start; gap:6px; padding:7px; border:1px solid rgba(255,255,255,.12); border-radius:8px; background:rgba(255,255,255,.04); font-size:.76em; line-height:1.35; cursor:pointer; }\n    .oair-radio-option input { margin-top:2px; flex:0 0 auto; }\n    .oair-library-modal { position:fixed; inset:0; z-index:3300; display:none; align-items:center; justify-content:center; padding:18px; background:radial-gradient(circle at 20% 12%, rgba(255,216,164,.13), transparent 34%), radial-gradient(circle at 82% 78%, rgba(104,160,255,.16), transparent 38%), rgba(0,0,0,.62); backdrop-filter:blur(3px); }\n    .oair-library-modal.oair-visible { display:flex; }\n    .oair-library-dialog { width:min(820px, calc(100vw - 36px)); max-height:min(820px, calc(100vh - 36px)); display:flex; flex-direction:column; border:1px solid rgba(255,255,255,.18); border-radius:16px; background:linear-gradient(180deg, rgba(255,255,255,.075), rgba(0,0,0,.18)), var(--SmartThemeBlurTintColor, rgba(28,28,44,.98)); box-shadow:0 22px 70px rgba(0,0,0,.72), 0 0 0 1px rgba(255,255,255,.04) inset; overflow:hidden; }\n    .oair-library-dialog-header,.oair-library-dialog-footer { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,.11); background:rgba(255,255,255,.035); }\n    .oair-library-dialog-footer { border-top:1px solid rgba(255,255,255,.11); border-bottom:0; justify-content:flex-end; flex-wrap:wrap; }\n    .oair-library-dialog-footer .menu_button,.oair-library-editor .menu_button,.oair-library-row-actions .menu_button { white-space:nowrap; word-break:keep-all; }\n    .oair-library-dialog-title { margin:0; font-size:1em; font-weight:800; letter-spacing:.03em; }\n    .oair-library-dialog-body { display:grid; grid-template-columns:minmax(240px,.9fr) minmax(300px,1.15fr); gap:12px; padding:14px; overflow:auto; }\n    .oair-library-list,.oair-library-editor { display:grid; gap:8px; align-content:start; }\n    .oair-library-list { max-height:min(560px, calc(100vh - 220px)); overflow:auto; padding-right:2px; }\n    .oair-library-row { border-radius:12px; padding:10px; background:rgba(255,255,255,.045); cursor:pointer; transition:border-color .16s ease, background .16s ease, transform .16s ease; }\n    .oair-library-row:hover { transform:translateY(-1px); background:rgba(255,255,255,.065); }\n    .oair-library-row:focus-visible { outline:2px solid rgba(104,160,255,.72); outline-offset:2px; }\n    .oair-library-row.oair-active { border-color:var(--SmartThemeQuoteColor,#68a0ff); background:linear-gradient(135deg, rgba(104,160,255,.16), rgba(255,216,164,.07)); }\n    .oair-library-row-actions { display:flex; flex-wrap:wrap; gap:5px; margin-top:4px; }\n    .oair-library-row-actions .menu_button { min-height:26px; padding:3px 8px; font-size:.72em; }\n    .oair-library-editor { padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:rgba(0,0,0,.12); }\n    .oair-library-editor .text_pole,.oair-library-row .text_pole { width:100%; box-sizing:border-box; }\n    .oair-library-editor textarea { min-height:180px; resize:vertical; line-height:1.5; }\n    .oair-library-row textarea.text_pole { min-height:96px; resize:vertical; line-height:1.45; }\n    .oair-library-row input[type=\"checkbox\"] { width:16px; height:16px; accent-color:var(--SmartThemeQuoteColor,#68a0ff); }\n    .oair-gallery-toolbar,.oair-history-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; }\n    .oair-gallery-actions,.oair-history-actions { display:flex; gap:6px; flex-wrap:nowrap; align-items:center; }\n    .oair-gallery-actions .menu_button,.oair-history-actions .menu_button { flex:0 0 auto; white-space:nowrap; word-break:keep-all; min-width:max-content; }\n    .oair-gallery-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(90px,1fr)); gap:8px; }\n    .oair-gallery-cell { position:relative; border-radius:8px; overflow:hidden; background:rgba(0,0,0,.2); aspect-ratio:1/1; }\n    .oair-gallery-cell img { width:100%; height:100%; object-fit:cover; cursor:pointer; display:block; }\n    .oair-gallery-cell-bar { position:absolute; bottom:0; left:0; right:0; display:flex; justify-content:center; gap:2px; padding:2px; background:rgba(0,0,0,.55); opacity:0; transition:opacity .15s; }\n    .oair-gallery-cell:hover .oair-gallery-cell-bar,.oair-gallery-cell:focus-within .oair-gallery-cell-bar { opacity:1; }\n    .oair-gallery-mini { border:none; background:transparent; cursor:pointer; font-size:13px; padding:2px 4px; line-height:1; }\n    .oair-pagination { grid-column:1/-1; display:flex; align-items:center; justify-content:center; gap:8px; margin-top:8px; flex-wrap:wrap; }\n    .oair-pagination .menu_button { min-height:26px; padding:3px 10px; white-space:nowrap; word-break:keep-all; }\n    .oair-pagination-info { font-size:.74em; opacity:.72; white-space:nowrap; }\n    .oair-gallery-cell img[role=\"button\"]:focus-visible,.oair-gallery-mini:focus-visible { outline:2px solid rgba(104,160,255,.78); outline-offset:2px; }\n    @media (max-width:720px){ .oair-workbench-grid,.oair-row,.oair-radio-group,.oair-library-dialog-body{grid-template-columns:1fr;} .oair-library-dialog{width:calc(100vw - 20px); max-height:calc(100vh - 20px);} .oair-tab-label{font-size:.76em; padding:7px 9px;} .oair-gallery-toolbar,.oair-history-toolbar{align-items:flex-start; flex-direction:column;} }\n\u003c/style\u003e\n\n\u003cdiv class=\"oair-settings-ui\"\u003e\n    \u003cdiv style=\"display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; gap:8px;\"\u003e\n        \u003cdiv id=\"oair_floating_status\" style=\"font-size:0.8em; color:var(--SmartThemeQuoteColor, #68a0ff);\"\u003e就绪\u003c/div\u003e\n        \u003clabel style=\"display:flex; align-items:center; gap:6px; font-size:0.8em; white-space:nowrap;\"\u003e\u003cinput id=\"oair_floating_enabled\" type=\"checkbox\"\u003e启用\u003c/label\u003e\n    \u003c/div\u003e\n\n    \u003cinput type=\"radio\" name=\"oair_tab\" id=\"oair_tab_workbench\" class=\"oair-tab-radio\" checked\u003e\n    \u003cinput type=\"radio\" name=\"oair_tab\" id=\"oair_tab_library\" class=\"oair-tab-radio\"\u003e\n    \u003cinput type=\"radio\" name=\"oair_tab\" id=\"oair_tab_prompts\" class=\"oair-tab-radio\"\u003e\n    \u003cinput type=\"radio\" name=\"oair_tab\" id=\"oair_tab_models\" class=\"oair-tab-radio\"\u003e\n    \u003cinput type=\"radio\" name=\"oair_tab\" id=\"oair_tab_history\" class=\"oair-tab-radio\"\u003e\n\n    \u003cdiv class=\"oair-tab-bar\"\u003e\n        \u003clabel for=\"oair_tab_workbench\" class=\"oair-tab-label\"\u003e生成工作台\u003c/label\u003e\n        \u003clabel for=\"oair_tab_library\" class=\"oair-tab-label\"\u003e设定库\u003c/label\u003e\n        \u003clabel for=\"oair_tab_prompts\" class=\"oair-tab-label\"\u003e提示词模板\u003c/label\u003e\n        \u003clabel for=\"oair_tab_models\" class=\"oair-tab-label\"\u003e模型后端\u003c/label\u003e\n        \u003clabel for=\"oair_tab_history\" class=\"oair-tab-label\"\u003e图库历史\u003c/label\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"oair-tab-panel\" id=\"oair_panel_workbench\"\u003e\n        \u003cdiv class=\"oair-workbench-grid\"\u003e\n            \u003cdiv class=\"oair-workbench-left\"\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e生成模式\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e工作台模式\u003c/label\u003e\u003cselect id=\"oair_generation_mode\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"single\"\u003e单图（默认）\u003c/option\u003e\u003coption value=\"multi\"\u003e多图（剧情递进图组）\u003c/option\u003e\u003coption value=\"comic\"\u003e漫画（分格 + 对白元数据）\u003c/option\u003e\u003c/select\u003e\u003cdiv class=\"oair-hint\"\u003e源文本会在单图、多图、漫画之间保留；自动流程勾选跟随时会使用这里的模式、张数、对白和失败策略。\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e源文本 / 手动生图\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e输入提示词 / 剧情原文\u003c/label\u003e\u003ctextarea id=\"oair_manual_prompt\" class=\"text_pole\" rows=\"6\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"描述你想生成的图片，或粘贴一整段剧情...\"\u003e\u003c/textarea\u003e\u003cdiv id=\"oair_manual_optimized_prompt\" style=\"display:none;\"\u003e\u003clabel class=\"oair-field-label\" style=\"color:#60ff90;\"\u003e✨ 精修后的编译提示词\u003c/label\u003e\u003cdiv id=\"oair_manual_optimized_text\" class=\"oair-optimized-box\"\u003e\u003c/div\u003e\u003cdiv class=\"oair-hint\" style=\"color:#60ff90;\"\u003e生成图片时将使用此精修版本\u003c/div\u003e\u003c/div\u003e\u003cdiv class=\"oair-btn-row\"\u003e\u003cbutton id=\"oair_btn_import_msg\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e📥 导入消息\u003c/button\u003e\u003cbutton id=\"oair_btn_optimize\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e✨ 精修提示词\u003c/button\u003e\u003cbutton id=\"oair_btn_manual_gen\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e🎨 生成图片\u003c/button\u003e\u003cbutton id=\"oair_btn_clear_manual\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e清空\u003c/button\u003e\u003cbutton id=\"oair_btn_attach\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e📎 附加到消息\u003c/button\u003e\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e单图取景策略\u003c/div\u003e\u003cselect id=\"oair_single_image_strategy\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"climax\"\u003e剧情高潮\u003c/option\u003e\u003coption value=\"poster\"\u003e总结海报\u003c/option\u003e\u003coption value=\"final\"\u003e最后镜头\u003c/option\u003e\u003c/select\u003e\u003cdiv class=\"oair-hint\"\u003e单图会先按这里规划一个画面目标，再由本地提示词编译器生成生图 prompt。\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e多图模式\u003c/div\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_multi_image_enabled\" type=\"checkbox\"\u003e启用多图模式（长剧情拆分为多个节点生成）\u003c/label\u003e\u003cdiv class=\"oair-row\"\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e默认生成张数\u003c/label\u003e\u003cinput id=\"oair_default_beat_count\" type=\"number\" min=\"2\" max=\"6\" step=\"1\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"3\"\u003e\u003c/div\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e失败策略\u003c/label\u003e\u003cselect id=\"oair_multi_image_failure_policy\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"stop\"\u003e停止并提示\u003c/option\u003e\u003coption value=\"continue\"\u003e继续保留成功项\u003c/option\u003e\u003coption value=\"retry\"\u003e预留重试\u003c/option\u003e\u003c/select\u003e\u003c/div\u003e\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e漫画模式\u003c/div\u003e\u003cdiv class=\"oair-row\"\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e分格数（2-8）\u003c/label\u003e\u003cinput id=\"oair_comic_panel_count\" type=\"number\" min=\"2\" max=\"8\" step=\"1\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"4\"\u003e\u003c/div\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e失败策略\u003c/label\u003e\u003cselect id=\"oair_comic_failure_policy\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"stop\"\u003e停止并提示\u003c/option\u003e\u003coption value=\"continue\"\u003e继续保留成功格\u003c/option\u003e\u003coption value=\"retry\"\u003e预留重试\u003c/option\u003e\u003c/select\u003e\u003c/div\u003e\u003c/div\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_comic_dialogue_enabled\" type=\"checkbox\"\u003e生成对白/旁白元数据\u003c/label\u003e\u003clabel class=\"oair-field-label\"\u003e对白模式\u003c/label\u003e\u003cselect id=\"oair_comic_dialogue_mode\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"bubble\"\u003e插件气泡（默认，画面不出现文字）\u003c/option\u003e\u003coption value=\"modelText\"\u003e模型画字（提示后端绘制中文气泡，可能不稳定）\u003c/option\u003e\u003c/select\u003e\u003cdiv class=\"oair-hint\"\u003e关闭时 planner 不强制创造对白；插件气泡会保存可读对白元数据，模型画中文字可能不稳定。\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e连续性策略 \u003cspan class=\"oair-badge oair-badge-orange\"\u003e预留\u003c/span\u003e\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e参考图策略\u003c/label\u003e\u003cselect id=\"oair_continuity_mode\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"off\"\u003e关闭（纯文生图）\u003c/option\u003e\u003coption value=\"previous\"\u003e上一张\u003c/option\u003e\u003coption value=\"firstAndPrevious\"\u003e首图 + 上一张\u003c/option\u003e\u003coption value=\"characterAndPrevious\"\u003e角色参考 + 上一张\u003c/option\u003e\u003c/select\u003e\u003cdiv class=\"oair-hint\"\u003e本阶段只把参考图写入 ImageJob 元数据，不改变文生图请求；真实图生图/编辑接口后续接入。\u003c/div\u003e\u003c/div\u003e\n            \u003c/div\u003e\n            \u003cdiv class=\"oair-workbench-right\"\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e自动整条 AI 消息生图\u003c/div\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_automatic_flow_enabled\" type=\"checkbox\"\u003e开启后，每条符合条件的新 AI 消息自动按整条正文生图\u003c/label\u003e\u003cdiv class=\"oair-hint\"\u003e自动生图只使用整条消息清洗、规划、编译和 Prompt Preflight；关闭后新 AI 消息不会自动触发生图。\u003c/div\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_automatic_flow_follow_workbench\" type=\"checkbox\"\u003e跟随当前工作台模式、张数、对白和失败策略\u003c/label\u003e\u003cdiv class=\"oair-row\"\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e最小正文字数\u003c/label\u003e\u003cinput id=\"oair_automatic_flow_min_chars\" type=\"number\" min=\"0\" step=\"10\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/div\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e单图失败策略\u003c/label\u003e\u003cselect id=\"oair_automatic_flow_failure_policy\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"stop\"\u003e停止并提示\u003c/option\u003e\u003coption value=\"continue\"\u003e继续保留成功项\u003c/option\u003e\u003coption value=\"retry\"\u003e预留重试\u003c/option\u003e\u003c/select\u003e\u003c/div\u003e\u003c/div\u003e\u003cdiv class=\"oair-row\"\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_automatic_flow_show_queue\" type=\"checkbox\"\u003e显示队列状态\u003c/label\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_automatic_flow_cancel_enabled\" type=\"checkbox\"\u003e允许取消安全任务\u003c/label\u003e\u003c/div\u003e\u003cdiv class=\"oair-btn-row\"\u003e\u003cbutton id=\"oair_btn_cancel_auto_queue\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e取消排队/运行中的自动任务\u003c/button\u003e\u003c/div\u003e\u003cdiv id=\"oair_automatic_flow_queue_status\" class=\"oair-hint\"\u003e自动队列：空闲\u003c/div\u003e\u003cdiv id=\"oair_automatic_flow_events\" class=\"oair-auto-flow-events\" aria-live=\"polite\"\u003e\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e进度\u003c/div\u003e\u003cdiv id=\"oair_plan_progress\" class=\"oair-progress-list\"\u003e\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e预览\u003c/div\u003e\u003cdiv id=\"oair_manual_preview\" class=\"oair-workbench-preview-grid\"\u003e\u003c/div\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e折叠日志\u003c/div\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e查看规划 / 编译 / 安全重写 / 生成摘要\u003c/summary\u003e\u003cdiv class=\"oair-log-box\"\u003e详细开发日志仍输出到浏览器 Console；这里仅显示适合 UI 的短摘要。\u003c/div\u003e\u003c/details\u003e\u003c/div\u003e\n                \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e图库快捷入口\u003c/div\u003e\u003cdiv class=\"oair-btn-row\"\u003e\u003clabel for=\"oair_tab_history\" class=\"menu_button\" style=\"flex:1; justify-content:center; cursor:pointer;\"\u003e打开图库历史\u003c/label\u003e\u003c/div\u003e\u003c/div\u003e\n            \u003c/div\u003e\n        \u003c/div\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"oair-tab-panel\" id=\"oair_panel_library\"\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e当前角色卡视觉设定 \u003cspan class=\"oair-badge oair-badge-green\"\u003e当前角色卡库\u003c/span\u003e\u003c/div\u003e\u003cdiv id=\"oair_visual_scope_status\" class=\"oair-hint\"\u003e人物库、场景库、当前风格/场景和确认人物只写入当前角色卡；旧全局设定不会自动回填。\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e风格库 \u003cspan class=\"oair-badge oair-badge-orange\"\u003e固定·画风\u003c/span\u003e\u003c/div\u003e\u003cinput id=\"oair_style_library\" type=\"hidden\"\u003e\u003cinput id=\"oair_style_active\" type=\"hidden\"\u003e\u003cdiv class=\"oair-hint\"\u003e风格、人物、场景统一在当前角色卡设定库维护，生成时按配置注入或自动选择。\u003c/div\u003e\u003cdiv class=\"oair-built-in-style-panel\"\u003e\u003cdiv class=\"oair-section-title\" style=\"font-size:.82em; margin-top:8px;\"\u003e插件内置风格\u003c/div\u003e\u003cdiv class=\"oair-hint\"\u003eBuilt-in style presets are visible here and import only into the current character card.\u003c/div\u003e\u003cdiv id=\"oair_builtin_style_presets\" class=\"oair-built-in-style-list\"\u003e\u003c/div\u003e\u003cdiv class=\"oair-btn-row\"\u003e\u003cbutton id=\"oair_btn_import_builtin_styles\" class=\"menu_button\" type=\"button\" style=\"flex:1; justify-content:center;\"\u003e导入内置风格到当前角色卡\u003c/button\u003e\u003c/div\u003e\u003c/div\u003e\u003cdiv id=\"oair_style_library_summary\" class=\"oair-library-summary\"\u003e\u003c/div\u003e\u003cdiv class=\"oair-library-toolbar\"\u003e\u003cbutton id=\"oair_btn_style_library\" class=\"menu_button\" type=\"button\"\u003e管理风格预设\u003c/button\u003e\u003c/div\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_style_auto_select\" type=\"checkbox\"\u003e由 LLM 按场景自动选风格\u003c/label\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e人物库 \u003cspan class=\"oair-badge oair-badge-green\"\u003e固定·画对人\u003c/span\u003e\u003c/div\u003e\u003cinput id=\"oair_character_appearance\" type=\"hidden\"\u003e\u003cdiv id=\"oair_character_library_summary\" class=\"oair-library-summary\"\u003e\u003c/div\u003e\u003cdiv class=\"oair-library-toolbar\"\u003e\u003cbutton id=\"oair_btn_character_library\" class=\"menu_button\" type=\"button\"\u003e管理人物预设\u003c/button\u003e\u003cbutton id=\"oair_btn_character_from_chat\" class=\"menu_button\" type=\"button\"\u003e从对话提取\u003c/button\u003e\u003cbutton id=\"oair_btn_character_from_worldbook\" class=\"menu_button\" type=\"button\"\u003e从世界书提取\u003c/button\u003e\u003cbutton id=\"oair_btn_character_clear\" class=\"menu_button\" type=\"button\"\u003e清空人物库\u003c/button\u003e\u003c/div\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_auto_extract_characters\" type=\"checkbox\"\u003e每次新 AI 消息自动提取人物到当前角色卡\u003c/label\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_character_llm_extract\" type=\"checkbox\"\u003e由 LLM 智能识别出场人物\u003c/label\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e场景库 \u003cspan class=\"oair-badge oair-badge-orange\"\u003e固定·地点环境\u003c/span\u003e\u003c/div\u003e\u003cinput id=\"oair_scene_library\" type=\"hidden\"\u003e\u003cinput id=\"oair_scene_active\" type=\"hidden\"\u003e\u003cdiv id=\"oair_scene_library_summary\" class=\"oair-library-summary\"\u003e\u003c/div\u003e\u003cdiv class=\"oair-library-toolbar\"\u003e\u003cbutton id=\"oair_btn_scene_library\" class=\"menu_button\" type=\"button\"\u003e管理场景预设\u003c/button\u003e\u003cbutton id=\"oair_btn_scene_from_chat\" class=\"menu_button\" type=\"button\"\u003e从对话提取\u003c/button\u003e\u003cbutton id=\"oair_btn_scene_from_worldbook\" class=\"menu_button\" type=\"button\"\u003e从世界书提取\u003c/button\u003e\u003cbutton id=\"oair_btn_scene_clear\" class=\"menu_button\" type=\"button\"\u003e清空场景库\u003c/button\u003e\u003c/div\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_auto_extract_scenes\" type=\"checkbox\"\u003e每次新 AI 消息自动提取场景到当前角色卡\u003c/label\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_scene_auto_select\" type=\"checkbox\"\u003e由 LLM 按原文自动选场景\u003c/label\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e世界书 / 固定设定清洗级别\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e固定设定清洗级别\u003c/label\u003e\u003cselect id=\"oair_visual_sanitization_level\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"strict\"\u003e严格\u003c/option\u003e\u003coption value=\"standard\"\u003e标准\u003c/option\u003e\u003coption value=\"loose\"\u003e宽松\u003c/option\u003e\u003c/select\u003e\u003cdiv class=\"oair-hint\"\u003e过滤世界书/人物/场景里的模板宏、TavernDB/Wrapper、插图插入任务规则和低视觉价值内容。\u003c/div\u003e\u003cdiv class=\"oair-row\"\u003e\u003cdiv\u003e\u003cdiv class=\"oair-section-title\" style=\"font-size:.82em; margin-top:8px;\"\u003e人物世界书策略\u003c/div\u003e\u003cdiv class=\"oair-radio-group\"\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_character_worldbook_mode\" value=\"off\"\u003e\u003cspan\u003e关闭\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e人物不读世界书。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_character_worldbook_mode\" value=\"inject\"\u003e\u003cspan\u003e生图时注入\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e命中人物时即时补充。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_character_worldbook_mode\" value=\"extract\"\u003e\u003cspan\u003e仅提取到库\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e只通过提取按钮入库。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003c/div\u003e\u003c/div\u003e\u003cdiv\u003e\u003cdiv class=\"oair-section-title\" style=\"font-size:.82em; margin-top:8px;\"\u003e场景世界书策略\u003c/div\u003e\u003cdiv class=\"oair-radio-group\"\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_scene_worldbook_mode\" value=\"off\"\u003e\u003cspan\u003e关闭\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e场景不读世界书。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_scene_worldbook_mode\" value=\"inject\"\u003e\u003cspan\u003e生图时注入\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e命中地点/环境时即时补充。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003clabel class=\"oair-radio-option\"\u003e\u003cinput type=\"radio\" name=\"oair_scene_worldbook_mode\" value=\"extract\"\u003e\u003cspan\u003e仅提取到库\u003cbr\u003e\u003cspan class=\"oair-hint\"\u003e只通过提取按钮入库。\u003c/span\u003e\u003c/span\u003e\u003c/label\u003e\u003c/div\u003e\u003c/div\u003e\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e世界书小节标题\u003c/label\u003e\u003cinput id=\"oair_worldbook_headings\" class=\"text_pole\" placeholder=\"外貌,长相,外观,appearance,场景,环境,setting,scene\"\u003e\u003clabel class=\"oair-field-label\"\u003e注入总字数上限\u003c/label\u003e\u003cinput id=\"oair_worldbook_maxchars\" class=\"text_pole\" type=\"number\" min=\"0\" placeholder=\"800\"\u003e\u003c/div\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"oair-tab-panel\" id=\"oair_panel_prompts\"\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e消息按钮入口\u003c/div\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_message_gen_enabled\" type=\"checkbox\"\u003e启用每条消息旁的生图按钮\u003c/label\u003e\u003cdiv class=\"oair-hint\"\u003e按钮入口读取当前消息并走 Prompt Compiler / Prompt Preflight，不再向主聊天模型注入图片标签要求。\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e提示词模板（分层）\u003c/div\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e必需：Chat Completions 后端模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_prompt_template\" class=\"text_pole\" rows=\"3\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e必需：Images API 后端模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_images_prompt_template\" class=\"text_pole\" rows=\"2\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\" open\u003e\u003csummary\u003e高级：精修模板（编译后可选）\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_optimize_template\" class=\"text_pole\" rows=\"10\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003cdiv class=\"oair-btn-row\"\u003e\u003cbutton id=\"oair_btn_reset_optimize_template\" class=\"menu_button\" style=\"flex:1; justify-content:center;\"\u003e↺ 重置为编译后精修模板\u003c/button\u003e\u003c/div\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e必需：多图分析模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_multi_analysis_template\" class=\"text_pole\" rows=\"8\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e必需：漫画分镜模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_comic_analysis_template\" class=\"text_pole\" rows=\"8\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e必需：人物/风格/场景选择模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_analysis_template\" class=\"text_pole\" rows=\"6\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e预留：清洗模板（当前未启用）\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003cdiv class=\"oair-hint\"\u003e当前清洗由本地 Prompt Preflight 完成，此模板暂不参与运行。\u003c/div\u003e\u003ctextarea id=\"oair_cleanup_template\" class=\"text_pole\" rows=\"5\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"预留：当前未启用\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e高级：消息总结模板\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003ctextarea id=\"oair_summarize_template\" class=\"text_pole\" rows=\"5\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e高级：安全重写模板（风险触发）\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003clabel class=\"oair-field-label\"\u003e安全重写级别\u003c/label\u003e\u003cselect id=\"oair_prompt_safety_level\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"strict\"\u003e严格\u003c/option\u003e\u003coption value=\"standard\"\u003e标准（保留非血腥动作）\u003c/option\u003e\u003coption value=\"loose\"\u003e宽松\u003c/option\u003e\u003c/select\u003e\u003ctextarea id=\"oair_nsfw_avoidance_template\" class=\"text_pole\" rows=\"7\" style=\"width:100%; box-sizing:border-box; margin-top:6px;\"\u003e\u003c/textarea\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_nsfw_avoidance\" type=\"checkbox\"\u003e启用安全重写\u003c/label\u003e\u003c/div\u003e\u003c/details\u003e\u003cdetails class=\"oair-details\"\u003e\u003csummary\u003e高级：后端返回图片解析\u003c/summary\u003e\u003cdiv class=\"oair-details-content\"\u003e\u003clabel class=\"oair-field-label\"\u003e返回图片正则回退\u003c/label\u003e\u003ctextarea id=\"oair_response_image_regex\" class=\"text_pole\" rows=\"2\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/textarea\u003e\u003cdiv class=\"oair-hint\"\u003e仅用于从后端文本响应里提取图片 URL；旧图片标签提取正则已不参与运行。\u003c/div\u003e\u003c/div\u003e\u003c/details\u003e\u003c/div\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"oair-tab-panel\" id=\"oair_panel_models\"\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e一键 chatgpt2api 预设\u003c/div\u003e\u003cbutton id=\"oair_btn_chatgpt2api_preset\" class=\"menu_button\" style=\"width:100%; justify-content:center;\"\u003e⚡ 一键 chatgpt2api 预设\u003c/button\u003e\u003cdiv class=\"oair-hint\"\u003eImages 模式 / gpt-image-2 / b64_json / 超时 600s。\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e图片后端连接\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003eAPI 模式\u003c/label\u003e\u003cselect id=\"oair_api_mode\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"chat\"\u003eChat Completions\u003c/option\u003e\u003coption value=\"images\"\u003eImages API\u003c/option\u003e\u003c/select\u003e\u003clabel class=\"oair-field-label\"\u003e服务地址\u003c/label\u003e\u003cinput id=\"oair_service_url\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"http://127.0.0.1:8199/v1\"\u003e\u003clabel class=\"oair-field-label\"\u003eAPI 密钥\u003c/label\u003e\u003cdiv class=\"oair-password-row\"\u003e\u003cinput id=\"oair_api_key\" type=\"password\" class=\"text_pole\" placeholder=\"sk-any\"\u003e\u003cbutton type=\"button\" class=\"oair-eye-btn\" title=\"显示/隐藏密钥\"\u003e\u003ci class=\"fa-solid fa-eye\"\u003e\u003c/i\u003e\u003c/button\u003e\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e模型\u003c/label\u003e\u003cdiv class=\"oair-model-row\"\u003e\u003cinput id=\"oair_model\" class=\"text_pole\" placeholder=\"any\"\u003e\u003cbutton id=\"oair_btn_fetch_model\" class=\"menu_button\"\u003e获取模型\u003c/button\u003e\u003c/div\u003e\u003cselect id=\"oair_model_select\" class=\"text_pole\"\u003e\u003c/select\u003e\u003clabel class=\"oair-field-label\"\u003e超时（毫秒）\u003c/label\u003e\u003cdiv class=\"oair-save-row\"\u003e\u003cinput id=\"oair_timeout_ms\" type=\"number\" min=\"1000\" step=\"1000\" class=\"text_pole\" placeholder=\"120000\"\u003e\u003cbutton id=\"oair_btn_save_api\" class=\"menu_button\"\u003e💾 保存设置\u003c/button\u003e\u003c/div\u003e\u003cdiv class=\"oair-row\"\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e图片尺寸\u003c/label\u003e\u003cselect id=\"oair_image_size\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"256x256\"\u003e256x256\u003c/option\u003e\u003coption value=\"512x512\"\u003e512x512\u003c/option\u003e\u003coption value=\"1024x1024\"\u003e1024x1024\u003c/option\u003e\u003coption value=\"1024x1792\"\u003e1024x1792\u003c/option\u003e\u003coption value=\"1792x1024\"\u003e1792x1024\u003c/option\u003e\u003c/select\u003e\u003c/div\u003e\u003cdiv\u003e\u003clabel class=\"oair-field-label\"\u003e生成数量\u003c/label\u003e\u003cinput id=\"oair_image_count\" type=\"number\" min=\"1\" max=\"10\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003c/div\u003e\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e响应格式\u003c/label\u003e\u003cselect id=\"oair_image_response_format\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\"\u003e\u003coption value=\"url\"\u003eURL\u003c/option\u003e\u003coption value=\"b64_json\"\u003eBase64\u003c/option\u003e\u003c/select\u003e\u003clabel class=\"oair-field-label\"\u003e额外请求体 JSON\u003c/label\u003e\u003ctextarea id=\"oair_extra_body\" class=\"text_pole\" rows=\"3\" style=\"width:100%; box-sizing:border-box;\" placeholder=\u0027{\"preset_name\":\"image\"}\u0027\u003e\u003c/textarea\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e文本步骤模型\u003c/div\u003e\u003clabel class=\"oair-toggle-label\"\u003e\u003cinput id=\"oair_optimize_enabled\" type=\"checkbox\"\u003e启用编译后精修\u003c/label\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:8px;\"\u003e\u003cinput id=\"oair_optimize_auto\" type=\"checkbox\"\u003e自动精修编译提示词\u003c/label\u003e\u003clabel class=\"oair-field-label\"\u003e文本回复长度上限 max_tokens\u003c/label\u003e\u003cinput id=\"oair_text_max_tokens\" class=\"text_pole\" type=\"number\" min=\"256\" step=\"256\" placeholder=\"8192\"\u003e\u003clabel class=\"oair-toggle-label\" style=\"margin-top:10px;\"\u003e\u003cinput id=\"oair_optimize_use_custom\" type=\"checkbox\"\u003e使用自定义精修 LLM 后端\u003c/label\u003e\u003cdiv class=\"oair-custom-backend-content\" id=\"oair_custom_backend_fields\"\u003e\u003cdiv class=\"oair-section-title\" style=\"font-size:.82em; margin-top:8px;\"\u003e自定义精修 LLM 后端\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e精修 LLM 服务地址\u003c/label\u003e\u003cinput id=\"oair_optimize_api_url\" class=\"text_pole\" style=\"width:100%; box-sizing:border-box;\" placeholder=\"http://127.0.0.1:11434/v1\"\u003e\u003clabel class=\"oair-field-label\"\u003e精修 LLM API 密钥\u003c/label\u003e\u003cdiv class=\"oair-password-row\"\u003e\u003cinput id=\"oair_optimize_api_key\" type=\"password\" class=\"text_pole\" placeholder=\"sk-...\"\u003e\u003cbutton type=\"button\" class=\"oair-eye-btn\" title=\"显示/隐藏密钥\"\u003e\u003ci class=\"fa-solid fa-eye\"\u003e\u003c/i\u003e\u003c/button\u003e\u003c/div\u003e\u003clabel class=\"oair-field-label\"\u003e精修 LLM 模型\u003c/label\u003e\u003cdiv class=\"oair-model-row\"\u003e\u003cinput id=\"oair_optimize_model\" class=\"text_pole\" placeholder=\"gpt-4o-mini\"\u003e\u003cbutton id=\"oair_btn_fetch_optimize_model\" class=\"menu_button\"\u003e获取模型\u003c/button\u003e\u003c/div\u003e\u003cselect id=\"oair_optimize_model_select\" class=\"text_pole\"\u003e\u003c/select\u003e\u003c/div\u003e\u003c/div\u003e\n    \u003c/div\u003e\n\n    \u003cdiv class=\"oair-tab-panel\" id=\"oair_panel_history\"\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-history-toolbar\"\u003e\u003cdiv class=\"oair-section-title\" style=\"margin:0;\"\u003e图库历史 \u003cspan id=\"oair_gallery_count\" class=\"oair-badge oair-badge-green\"\u003e0 张\u003c/span\u003e\u003c/div\u003e\u003cdiv class=\"oair-history-actions oair-gallery-actions\"\u003e\u003cbutton id=\"oair_btn_gallery_refresh\" class=\"menu_button\"\u003e刷新\u003c/button\u003e\u003cbutton id=\"oair_btn_gallery_clear\" class=\"menu_button\"\u003e清空图库\u003c/button\u003e\u003c/div\u003e\u003c/div\u003e\u003cdiv class=\"oair-hint\"\u003e点击缩略图放大；清空图库只清记录，不删磁盘文件。刷新/清空按钮保持横向排布，避免中文竖排。\u003c/div\u003e\u003cdiv id=\"oair_gallery_grid\" class=\"oair-gallery-grid\" style=\"margin-top:8px;\"\u003e\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-history-toolbar\"\u003e\u003cdiv class=\"oair-section-title\" style=\"margin:0;\"\u003e生成历史 \u003cspan id=\"oair_generation_history_count\" class=\"oair-badge oair-badge-orange\"\u003e0 条\u003c/span\u003e\u003c/div\u003e\u003cdiv class=\"oair-history-actions\"\u003e\u003cbutton id=\"oair_btn_history_refresh\" class=\"menu_button\"\u003e刷新\u003c/button\u003e\u003cbutton id=\"oair_btn_history_clear\" class=\"menu_button\"\u003e清空历史\u003c/button\u003e\u003c/div\u003e\u003c/div\u003e\u003cdiv id=\"oair_generation_history_list\" class=\"oair-history-list\" style=\"margin-top:8px;\"\u003e\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e失败记录\u003c/div\u003e\u003cdiv id=\"oair_failed_history_list\" class=\"oair-history-list\"\u003e\u003c/div\u003e\u003c/div\u003e\n        \u003cdiv class=\"oair-section\"\u003e\u003cdiv class=\"oair-section-title\"\u003e重试入口\u003c/div\u003e\u003cdiv id=\"oair_retry_history_list\" class=\"oair-history-list\"\u003e\u003c/div\u003e\u003c/div\u003e\n    \u003c/div\u003e\n\u003c/div\u003e\n";
/**
 * 加载完整设置 HTML 到悬浮窗 body，并初始化绑定和默认标签
 */
function loadFullSettings(body, html) {
    body.html(html);
    bindFloatingEvents();
    updateFloatingUi();
    refreshGalleryUi();

    // Set default tab
    const s = extension_settings[extensionName];
    const tabMap = {
        workbench: "#oair_tab_workbench",
        generate: "#oair_tab_workbench",
        manual: "#oair_tab_workbench",
        library: "#oair_tab_library",
        style: "#oair_tab_library",
        character: "#oair_tab_library",
        worldbook: "#oair_tab_library",
        scene: "#oair_tab_library",
        prompts: "#oair_tab_prompts",
        templates: "#oair_tab_prompts",
        extract: "#oair_tab_prompts",
        models: "#oair_tab_models",
        basic: "#oair_tab_models",
        backend: "#oair_tab_models",
        text: "#oair_tab_models",
        optimize: "#oair_tab_models",
        history: "#oair_tab_history",
        gallery: "#oair_tab_history",
    };
    const targetTab = tabMap[s.floatingDefaultTab] || tabMap.workbench;
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
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, injectMessageActionsForVisibleMessages);
        eventSource.on(event_types.CHAT_LOADED, () => setTimeout(injectMessageActionsForVisibleMessages, 300));
        setTimeout(injectMessageActionsForVisibleMessages, 0);
        setTimeout(injectMessageActionsForVisibleMessages, 1500);

        // 聊天切换时清理 inFlightMessages，避免旧聊天的 key 残留
        eventSource.on(event_types.CHAT_CHANGED, () => {
            inFlightMessages.clear();
            cancelAutomaticMessageTasks();
            automaticMessageInFlight.clear();
            clearWorldBookCache();
            manualWorkbenchState.characterCandidates = [];
            manualWorkbenchState.confirmedCharacters = [];
            updateFloatingUi();
            refreshWorkbenchCharacterCandidates();
            setTimeout(injectMessageActionsForVisibleMessages, 300);
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

let floatingViewportFitTimer = null;
let floatingVisualScopeRefreshTimer = null;
let lastRenderedVisualScopeKey = "";
const FLOATING_VISUAL_SCOPE_REFRESH_MS = 350;

function getFloatingPanelViewportMargin() {
    return window.innerWidth <= 400 ? 4 : 8;
}

function fitFloatingPanelToViewport(panelLike) {
    const panel = $(panelLike);
    const el = panel[0];
    if (!el) return;

    const margin = getFloatingPanelViewportMargin();
    const viewportWidth = Math.max(0, window.innerWidth || document.documentElement?.clientWidth || 0);
    const viewportHeight = Math.max(0, window.innerHeight || document.documentElement?.clientHeight || 0);
    const availableWidth = Math.max(240, viewportWidth - margin * 2);
    const availableHeight = Math.max(220, viewportHeight - margin * 2);

    el.style.setProperty("box-sizing", "border-box", "important");
    el.style.setProperty("max-width", `${availableWidth}px`, "important");
    el.style.setProperty("max-height", `${availableHeight}px`, "important");
    el.style.setProperty("min-width", availableWidth < 520 ? "0" : "520px", "important");
    el.style.setProperty("min-height", `${Math.min(460, availableHeight)}px`, "important");

    if (availableWidth < 640) {
        el.style.setProperty("width", `${availableWidth}px`, "important");
    } else {
        el.style.removeProperty("width");
    }

    if (availableHeight < 460) {
        el.style.setProperty("height", `${availableHeight}px`, "important");
    } else {
        el.style.removeProperty("height");
    }

    clampFloatingPanelToViewport(panel);
}

function clampFloatingPanelToViewport(panelLike) {
    const panel = $(panelLike);
    const el = panel[0];
    if (!el) return;

    const margin = getFloatingPanelViewportMargin();
    for (let i = 0; i < 3; i++) {
        const rect = el.getBoundingClientRect();
        const maxRight = window.innerWidth - margin;
        const maxBottom = window.innerHeight - margin;
        let dx = 0;
        let dy = 0;

        if (rect.width > window.innerWidth - margin * 2) {
            dx = margin - rect.left;
        } else if (rect.left < margin) {
            dx = margin - rect.left;
        } else if (rect.right > maxRight) {
            dx = maxRight - rect.right;
        }

        if (rect.height > window.innerHeight - margin * 2) {
            dy = margin - rect.top;
        } else if (rect.top < margin) {
            dy = margin - rect.top;
        } else if (rect.bottom > maxBottom) {
            dy = maxBottom - rect.bottom;
        }

        if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) break;

        const left = Number.parseFloat(panel.css("left"));
        const top = Number.parseFloat(panel.css("top"));

        if (Number.isFinite(left) && Math.abs(dx) > 0.5) {
            el.style.setProperty("transform", "none", "important");
            el.style.setProperty("left", `${Math.max(margin, left + dx)}px`, "important");
        }
        if (Number.isFinite(top) && Math.abs(dy) > 0.5) {
            el.style.setProperty("top", `${Math.max(margin, top + dy)}px`, "important");
        }
    }
}

function bindFloatingViewportFit(panelLike) {
    const panel = $(panelLike);
    if (!panel.length) return;

    $(window).off("resize.oair_floating orientationchange.oair_floating");
    $(window).on("resize.oair_floating orientationchange.oair_floating", function () {
        if (!panel.hasClass("oair-floating--visible")) return;
        if (floatingViewportFitTimer) window.clearTimeout(floatingViewportFitTimer);
        floatingViewportFitTimer = window.setTimeout(() => {
            floatingViewportFitTimer = null;
            fitFloatingPanelToViewport(panel);
        }, 40);
    });

    fitFloatingPanelToViewport(panel);
}

function refreshFloatingUiIfVisualScopeChanged() {
    const panel = $("#oair_floating_panel");
    if (!panel.length || !panel.hasClass("oair-floating--visible")) return;

    const currentScopeKey = createChatVisualScopeKey(getCurrentChatVisualContext());
    if (!lastRenderedVisualScopeKey) {
        lastRenderedVisualScopeKey = currentScopeKey;
        return;
    }
    if (currentScopeKey === lastRenderedVisualScopeKey) return;

    manualWorkbenchState.characterCandidates = [];
    manualWorkbenchState.confirmedCharacters = [];
    updateFloatingUi();
    refreshWorkbenchCharacterCandidates();
}

function startFloatingVisualScopeWatch(panelLike = "#oair_floating_panel") {
    const panel = $(panelLike);
    if (!panel.length) return;

    stopFloatingVisualScopeWatch();
    refreshFloatingUiIfVisualScopeChanged();
    floatingVisualScopeRefreshTimer = window.setInterval(() => {
        refreshFloatingUiIfVisualScopeChanged();
    }, FLOATING_VISUAL_SCOPE_REFRESH_MS);
    $(window).off("focus.oair_visualscope").on("focus.oair_visualscope", refreshFloatingUiIfVisualScopeChanged);
    $(document).off("visibilitychange.oair_visualscope").on("visibilitychange.oair_visualscope", refreshFloatingUiIfVisualScopeChanged);
}

function stopFloatingVisualScopeWatch() {
    if (floatingVisualScopeRefreshTimer) {
        window.clearInterval(floatingVisualScopeRefreshTimer);
        floatingVisualScopeRefreshTimer = null;
    }
    $(window).off("focus.oair_visualscope");
    $(document).off("visibilitychange.oair_visualscope");
    lastRenderedVisualScopeKey = "";
}

async function createFloatingPanel() {
    if ($("#oair_floating_panel").length) return;

    const panel = $(`
        <div id="oair_floating_panel" style="min-height:460px; height:auto; position:fixed; z-index:3200; overflow:hidden; flex-direction:column;">
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
    bindFloatingViewportFit(panel);
    startFloatingVisualScopeWatch(panel);

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
        if (headerDragging) clampFloatingPanelToViewport(panel);
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
        width: "",
        maxWidth: "",
        maxHeight: "",
        minWidth: "",
    });

    // Clean up document-level event handlers (mouse + touch + keyboard)
    $(document).off("mousemove.oair_floating mouseup.oair_floating touchmove.oair_floating touchend.oair_floating touchcancel.oair_floating keydown.oair_floating");
    $(window).off("resize.oair_floating orientationchange.oair_floating");
    if (floatingViewportFitTimer) {
        window.clearTimeout(floatingViewportFitTimer);
        floatingViewportFitTimer = null;
    }
    stopFloatingVisualScopeWatch();

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
        bindFloatingViewportFit(newPanel);

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
            if (headerDragging) clampFloatingPanelToViewport(panel);
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
            if (headerDragging) clampFloatingPanelToViewport(panel);
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
            workbench: "#oair_tab_workbench",
            generate: "#oair_tab_workbench",
            manual: "#oair_tab_workbench",
            library: "#oair_tab_library",
            style: "#oair_tab_library",
            character: "#oair_tab_library",
            worldbook: "#oair_tab_library",
            scene: "#oair_tab_library",
            prompts: "#oair_tab_prompts",
            templates: "#oair_tab_prompts",
            extract: "#oair_tab_prompts",
            models: "#oair_tab_models",
            basic: "#oair_tab_models",
            backend: "#oair_tab_models",
            text: "#oair_tab_models",
            optimize: "#oair_tab_models",
            history: "#oair_tab_history",
            gallery: "#oair_tab_history",
        };
        const targetTab = tabMap[s.floatingDefaultTab] || tabMap.workbench;
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
        bindFloatingViewportFit(panel);
        startFloatingVisualScopeWatch(panel);

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
    bindSettingInput("#oair_message_gen_enabled", "messageGenEnabled", () => fp.find("#oair_message_gen_enabled").prop("checked"));
    bindSettingInput("#oair_summarize_template", "summarizeTemplate", () => fp.find("#oair_summarize_template").val());
    bindSettingInput("#oair_automatic_flow_enabled", "automaticFlowEnabled", () => fp.find("#oair_automatic_flow_enabled").prop("checked"));
    bindSettingInput("#oair_automatic_flow_follow_workbench", "automaticFlowFollowWorkbench", () => fp.find("#oair_automatic_flow_follow_workbench").prop("checked"));
    bindSettingInput("#oair_automatic_flow_min_chars", "automaticFlowMinChars", () => Math.max(0, Number(fp.find("#oair_automatic_flow_min_chars").val()) || 0));
    bindSettingInput("#oair_automatic_flow_failure_policy", "automaticFlowFailurePolicy", () => normalizeAutomaticFlowFailurePolicy(fp.find("#oair_automatic_flow_failure_policy").val()));
    bindSettingInput("#oair_automatic_flow_show_queue", "automaticFlowShowQueue", () => fp.find("#oair_automatic_flow_show_queue").prop("checked"));
    bindSettingInput("#oair_automatic_flow_cancel_enabled", "automaticFlowCancelEnabled", () => fp.find("#oair_automatic_flow_cancel_enabled").prop("checked"));
    bindSettingInput("#oair_multi_image_enabled", "multiImageEnabled", () => {
        const checked = fp.find("#oair_multi_image_enabled").prop("checked");
        // 与生成模式选择器联动：勾选=多图，取消=单图（不影响 comic 之外的状态）
        const s = extension_settings[extensionName];
        s.generationMode = checked ? "multi" : (s.generationMode === "multi" ? "single" : s.generationMode);
        fp.find("#oair_generation_mode").val(normalizeGenerationMode(s.generationMode));
        return checked;
    });
    bindSettingInput("#oair_generation_mode", "generationMode", () => {
        const mode = normalizeGenerationMode(fp.find("#oair_generation_mode").val());
        // 同步旧开关，保持 Phase 4 兼容
        extension_settings[extensionName].multiImageEnabled = mode === "multi";
        fp.find("#oair_multi_image_enabled").prop("checked", mode === "multi");
        return mode;
    });
    bindSettingInput("#oair_default_beat_count", "defaultBeatCount", () => normalizeBeatCount(fp.find("#oair_default_beat_count").val()));
    bindSettingInput("#oair_multi_image_failure_policy", "multiImageFailurePolicy", () => normalizePlanFailurePolicy(fp.find("#oair_multi_image_failure_policy").val()));
    bindSettingInput("#oair_comic_panel_count", "comicPanelCount", () => normalizeComicPanelCount(fp.find("#oair_comic_panel_count").val()));
    bindSettingInput("#oair_comic_dialogue_enabled", "comicDialogueEnabled", () => fp.find("#oair_comic_dialogue_enabled").prop("checked"));
    bindSettingInput("#oair_comic_dialogue_mode", "comicDialogueMode", () => normalizeComicDialogueMode(fp.find("#oair_comic_dialogue_mode").val()));
    bindSettingInput("#oair_comic_failure_policy", "comicFailurePolicy", () => normalizePlanFailurePolicy(fp.find("#oair_comic_failure_policy").val()));
    bindSettingInput("#oair_continuity_mode", "continuityMode", () => normalizeContinuityMode(fp.find("#oair_continuity_mode").val()));
    fp.find("#oair_btn_cancel_auto_queue").off("click.oair_auto").on("click.oair_auto", (e) => {
        e.preventDefault();
        const s = extension_settings[extensionName];
        if (!s.automaticFlowCancelEnabled) {
            toastr.warning("自动任务取消功能未启用。");
            return;
        }
        const chatId = getContext()?.chatId || "chat";
        const cancelled = cancelAutomaticMessageTasks(chatId);
        if (cancelled) {
            toastr.info(`已请求取消 ${cancelled} 个自动任务。`);
        } else {
            toastr.info("当前没有可取消的自动任务。");
        }
    });

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

    // ─── 后端响应解析 ──────────────────────────────────────
    bindSettingInput("#oair_response_image_regex", "responseImageRegex", () => fp.find("#oair_response_image_regex").val());

    // ─── 优化设置 ──────────────────────────────────────────
    bindSettingInput("#oair_optimize_enabled", "optimizeEnabled", () => fp.find("#oair_optimize_enabled").prop("checked"));
    bindSettingInput("#oair_optimize_auto", "optimizeAuto", () => fp.find("#oair_optimize_auto").prop("checked"));
    bindSettingInput("#oair_optimize_template", "optimizeTemplate", () => fp.find("#oair_optimize_template").val());
    bindSettingInput("#oair_multi_analysis_template", "multiAnalysisTemplate", () => fp.find("#oair_multi_analysis_template").val());
    bindSettingInput("#oair_comic_analysis_template", "comicAnalysisTemplate", () => fp.find("#oair_comic_analysis_template").val());
    bindSettingInput("#oair_analysis_template", "analysisTemplate", () => fp.find("#oair_analysis_template").val());
    bindSettingInput("#oair_cleanup_template", "cleanupTemplate", () => fp.find("#oair_cleanup_template").val());
    bindSettingInput("#oair_single_image_strategy", "singleImageStrategy", () => normalizeSingleImageStrategy(fp.find("#oair_single_image_strategy").val()));
    bindSettingInput("#oair_visual_sanitization_level", "visualSanitizationLevel", () => normalizeVisualSanitizationLevel(fp.find("#oair_visual_sanitization_level").val()));
    bindSettingInput("#oair_prompt_safety_level", "promptSafetyLevel", () => normalizePromptSafetyLevel(fp.find("#oair_prompt_safety_level").val()));
    bindSettingInput("#oair_text_max_tokens", "textMaxTokens", () => Number(fp.find("#oair_text_max_tokens").val()) || 8192);
    // ─── 设定库（风格 / 人物 / 场景）───────────────────────────
    bindVisualScopeInput("#oair_character_appearance", "characterAppearance", () => fp.find("#oair_character_appearance").val());
    bindVisualScopeInput("#oair_style_library", "styleLibrary", () => fp.find("#oair_style_library").val());
    bindVisualScopeInput("#oair_style_active", "styleActive", () => fp.find("#oair_style_active").val());
    bindVisualScopeInput("#oair_scene_library", "sceneLibrary", () => fp.find("#oair_scene_library").val());
    bindVisualScopeInput("#oair_scene_active", "sceneActive", () => fp.find("#oair_scene_active").val());
    bindSettingInput("#oair_style_auto_select", "styleAutoSelect", () => fp.find("#oair_style_auto_select").prop("checked"));
    bindSettingInput("#oair_character_llm_extract", "characterLlmExtract", () => fp.find("#oair_character_llm_extract").prop("checked"));
    bindSettingInput("#oair_auto_extract_characters", "autoExtractCharactersEnabled", () => fp.find("#oair_auto_extract_characters").prop("checked"));
    bindSettingInput("#oair_auto_extract_scenes", "autoExtractScenesEnabled", () => fp.find("#oair_auto_extract_scenes").prop("checked"));
    bindSettingInput("#oair_scene_auto_select", "sceneAutoSelect", () => fp.find("#oair_scene_auto_select").prop("checked"));
    fp.find("#oair_btn_import_builtin_styles").off("click.oair_styles").on("click.oair_styles", (e) => {
        e.preventDefault();
        importBuiltInStylesIntoCurrentCard();
    });
    fp.find("#oair_btn_style_library").off("click.oair_lib").on("click.oair_lib", (e) => {
        e.preventDefault();
        openLibraryModal("style");
    });
    fp.find("#oair_btn_character_library").off("click.oair_lib").on("click.oair_lib", (e) => {
        e.preventDefault();
        openLibraryModal("character");
    });
    fp.find("#oair_btn_scene_library").off("click.oair_lib").on("click.oair_lib", (e) => {
        e.preventDefault();
        openLibraryModal("scene");
    });
    fp.find("#oair_btn_character_clear").off("click.oair_lib").on("click.oair_lib", (e) => {
        e.preventDefault();
        clearLibrary("character");
    });
    fp.find("#oair_btn_scene_clear").off("click.oair_lib").on("click.oair_lib", (e) => {
        e.preventDefault();
        clearLibrary("scene");
    });
    fp.find("#oair_btn_character_from_chat").off("click.oair_extract").on("click.oair_extract", async (e) => {
        e.preventDefault();
        await extractLibraryFromChat("character");
    });
    fp.find("#oair_btn_character_from_worldbook").off("click.oair_extract").on("click.oair_extract", async (e) => {
        e.preventDefault();
        await extractLibraryFromWorldBook("character");
    });
    fp.find("#oair_btn_scene_from_chat").off("click.oair_extract").on("click.oair_extract", async (e) => {
        e.preventDefault();
        await extractLibraryFromChat("scene");
    });
    fp.find("#oair_btn_scene_from_worldbook").off("click.oair_extract").on("click.oair_extract", async (e) => {
        e.preventDefault();
        await extractLibraryFromWorldBook("scene");
    });
    fp.find('input[name="oair_character_worldbook_mode"]').off("change.oair_mode").on("change.oair_mode", function () {
        const mode = String($(this).val() || "off");
        const s = extension_settings[extensionName];
        s.characterWorldBookMode = ["off", "inject", "extract"].includes(mode) ? mode : "off";
        normalizeWorldBookModes(s, { hadCharacterMode: true, hadSceneMode: true });
        saveSettingsDebounced();
        renderAllLibrarySummaries();
    });
    fp.find('input[name="oair_scene_worldbook_mode"]').off("change.oair_mode").on("change.oair_mode", function () {
        const mode = String($(this).val() || "off");
        const s = extension_settings[extensionName];
        s.sceneWorldBookMode = ["off", "inject", "extract"].includes(mode) ? mode : "off";
        normalizeWorldBookModes(s, { hadCharacterMode: true, hadSceneMode: true });
        saveSettingsDebounced();
        renderAllLibrarySummaries();
    });
    bindSettingInput("#oair_worldbook_headings", "worldBookSectionHeadings", () => fp.find("#oair_worldbook_headings").val());
    bindSettingInput("#oair_worldbook_maxchars", "worldBookMaxChars", () => Number(fp.find("#oair_worldbook_maxchars").val()) || 0);

    // 自定义精修 LLM 后端复选框
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

    // 获取自定义精修 LLM 模型列表按钮
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

    // ─── 安全重写 ──────────────────────────────────────────
    bindSettingInput("#oair_nsfw_avoidance", "nsfwAvoidance", () => fp.find("#oair_nsfw_avoidance").prop("checked"));
    bindSettingInput("#oair_nsfw_avoidance_template", "nsfwAvoidanceTemplate", () => fp.find("#oair_nsfw_avoidance_template").val());

    // ─── 手动生图 ──────────────────────────────────────────
    fp.find("#oair_btn_manual_gen").off("click").on("click", (e) => { e.preventDefault(); manualGenerate(); });
    fp.find("#oair_btn_optimize").off("click").on("click", (e) => { e.preventDefault(); manualOptimize(); });
    fp.find("#oair_btn_clear_manual").off("click").on("click", (e) => {
        e.preventDefault();
        fp.find("#oair_manual_preview").empty();
        fp.find("#oair_plan_progress").empty();
        fp.find("#oair_manual_optimized_prompt").hide();
        fp.find("#oair_manual_optimized_text").text("");
        fp.find("#oair_manual_prompt").val("");
        manualWorkbenchState.characterCandidates = [];
        manualWorkbenchState.confirmedCharacters = [];
        manualWorkbenchState.lastJobs = [];
        renderCharacterConfirmationUi();
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
        refreshWorkbenchCharacterCandidates();
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
        // 找最后一条 AI（助手）消息——用于给 AI 的旁白/场景配图，而不是用户自己的输入
        let lastMsg = null;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && !chat[i].is_system) {
                lastMsg = chat[i];
                break;
            }
        }
        if (!lastMsg) {
            // 回退：没有助手消息时取最后一条消息
            lastMsg = chat[chat.length - 1];
        }
        const text = cleanRpText(lastMsg.mes || lastMsg.content || "");
        if (!text.trim()) {
            toastr.warning("消息内容为空");
            return;
        }
        fp.find("#oair_manual_prompt").val(text);
        // 清除之前的优化结果
        fp.find("#oair_manual_optimized_prompt").hide();
        fp.find("#oair_manual_optimized_text").text("");
        refreshWorkbenchCharacterCandidates();
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
        attachGeneratedImages(lastAssistantMsg, previewImgs, ["手动生图"], createDialogueAttachmentMetadata(manualWorkbenchState.lastJobs));
        // 仅附加图片，不重新渲染正文（rerenderMessage:false）——保留该消息已渲染的 HTML，避免被重置回源码格式
        await updateMessageBlockWhenReady(lastAssistantIdx, lastAssistantMsg, { rerenderMessage: false });
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

    // 重置精修模板为编译后轻量精修模板
    fp.find("#oair_btn_reset_optimize_template").off("click").on("click", (e) => {
        e.preventDefault();
        const s = extension_settings[extensionName];
        s.optimizeTemplate = DEFAULT_OPTIMIZE_TEMPLATE;
        saveSettingsDebounced();
        fp.find("#oair_optimize_template").val(DEFAULT_OPTIMIZE_TEMPLATE);
        setStatus("已重置为编译后精修模板", "success");
        toastr.success("精修模板已重置：保留编译器规划，只做轻量润色。");
    });

    // 隐藏存储字段被弹窗/提取按钮改写后，同步摘要。
    fp.find("#oair_style_library, #oair_style_active, #oair_character_appearance, #oair_scene_library, #oair_scene_active")
        .off("input.oair_library change.oair_library")
        .on("input.oair_library change.oair_library", () => renderAllLibrarySummaries());

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

    // ─── 图库 ──────────────────────────────────────────────
    fp.find("#oair_btn_gallery_refresh").off("click").on("click", (e) => {
        e.preventDefault();
        refreshGalleryUi();
        refreshGenerationHistoryUi();
    });
    fp.find("#oair_btn_gallery_clear").off("click").on("click", (e) => {
        e.preventDefault();
        if (confirm("清空整个图库记录？（磁盘上的图片文件不会被删除）")) {
            clearGallery();
            toastr.success("图库已清空");
        }
    });
    fp.find("#oair_btn_history_refresh").off("click").on("click", (e) => {
        e.preventDefault();
        refreshGenerationHistoryUi();
    });
    fp.find("#oair_btn_history_clear").off("click").on("click", (e) => {
        e.preventDefault();
        if (confirm("清空生成历史记录？（不会删除磁盘图片文件）")) {
            clearGenerationHistory();
            toastr.success("生成历史已清空");
        }
    });

    refreshWorkbenchCharacterCandidates();
    renderPlanProgress(manualWorkbenchState.lastJobs);
    refreshGenerationHistoryUi();
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

function bindVisualScopeInput(selector, key, getter) {
    $(selector).off("input.oair change.oair").on("input.oair change.oair", () => {
        saveCurrentChatVisualScopePatch({ [key]: getter() });
        renderAllLibrarySummaries();
        applyMainPromptInjection();
    });
}

function getCurrentChatVisualContext() {
    const ctx = getContext?.() || {};
    const chatMetadata = ctx.chatMetadata || {};
    let runtimeChatId = "";
    try {
        runtimeChatId = typeof ctx.getCurrentChatId === "function" ? ctx.getCurrentChatId() : "";
    } catch (_) {}
    const character = Array.isArray(ctx.characters) && ctx.characterId != null
        ? ctx.characters[ctx.characterId]
        : null;
    const characterId = ctx.characterId ?? ctx.character?.id ?? character?.id ?? "";
    const characterName = character?.name || ctx.name2 || ctx.characterName || ctx.name || "";
    const characterAvatar = character?.avatar || ctx.characterAvatar || ctx.avatar || "";
    return {
        chatId: ctx.chatId || runtimeChatId || chatMetadata.chat_id || chatMetadata.chatId || chatMetadata.file_name || chatMetadata.name || "chat",
        chatFile: chatMetadata.file_name || chatMetadata.filename || chatMetadata.chat_file || chatMetadata.name || "",
        chatMetadata,
        userName: ctx.userName || ctx.name1 || name1 || chatMetadata.userName || chatMetadata.name1 || "",
        name1: ctx.name1 || name1 || chatMetadata.name1 || chatMetadata.userName || "",
        personaName: ctx.personaName || ctx.userName || ctx.name1 || name1 || chatMetadata.personaName || chatMetadata.userName || "",
        personaAppearance: ctx.personaAppearance || ctx.userAppearance || chatMetadata.personaAppearance || chatMetadata.userAppearance || "",
        personaDescription: ctx.personaDescription || ctx.userDescription || chatMetadata.personaDescription || chatMetadata.userDescription || "",
        characterId: characterId,
        characterName: characterName,
        characterAvatar: characterAvatar,
        characterCardKey: characterAvatar || characterId || characterName,
    };
}

function getChatVisualStore() {
    return {
        getItem(key) {
            try { return localStorage.getItem(key); } catch { return null; }
        },
        setItem(key, value) {
            try { localStorage.setItem(key, value); } catch (err) { console.warn(`[${extensionName}] visual scope save failed`, err); }
        },
    };
}

function scheduleChatMetadataSave(ctx = getContext?.()) {
    if (!ctx || typeof ctx.saveChat !== "function") return;
    clearTimeout(chatVisualMetadataSaveTimer);
    chatVisualMetadataSaveTimer = setTimeout(() => {
        Promise.resolve(ctx.saveChat()).catch((err) => console.warn(`[${extensionName}] chat visual metadata save failed`, err));
    }, 250);
}

function loadCurrentChatVisualScope(settings = extension_settings[extensionName]) {
    return loadChatVisualScope({
        context: getCurrentChatVisualContext(),
        settings,
        store: getChatVisualStore(),
    });
}

function getEffectiveVisualSettings(settings = extension_settings[extensionName]) {
    const scope = loadCurrentChatVisualScope(settings);
    return {
        ...settings,
        ...scope.values,
        __visualScopeKey: scope.scopeKey,
        __visualScopeSources: scope.sources,
    };
}

function saveCurrentChatVisualScopePatch(patch = {}) {
    const cleanPatch = {};
    for (const key of CHAT_VISUAL_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
            cleanPatch[key] = patch[key];
        }
    }
    if (!Object.keys(cleanPatch).length) return null;
    return saveChatVisualScopePatch({
        context: getCurrentChatVisualContext(),
        store: getChatVisualStore(),
        patch: cleanPatch,
    });
}

function resolveCurrentChatVisualBible(sourceText, settings = extension_settings[extensionName]) {
    return resolveChatVisualBible({
        context: getCurrentChatVisualContext(),
        settings,
        store: getChatVisualStore(),
        sourceText,
    });
}

function getVisualScopeLabel(settings = extension_settings[extensionName]) {
    const scope = loadCurrentChatVisualScope(settings);
    const sourceText = Object.values(scope.sources).includes("card") ? "当前角色卡" : "角色卡空库";
    return `${sourceText} · ${createChatVisualScopeKey(getCurrentChatVisualContext()).replace(/^ST-OpenAI-Image-Relay:visual-scope:/, "")}`;
}

function updateVisualScopeStatus() {
    const fp = $("#oair_floating_panel");
    fp.find("#oair_visual_scope_status").text(`当前视觉设定作用域：${getVisualScopeLabel()}`);
}

// ─── Library UI helpers (style / character / scene) ───────────

const LIBRARY_CONFIGS = {
    style: {
        key: "styleLibrary",
        activeKey: "styleActive",
        summarySelector: "#oair_style_library_summary",
        title: "风格库",
        nameLabel: "风格名",
        bodyLabel: "风格描述",
        emptyText: "当前角色卡还没有风格预设。可导入上方内置风格，或点击“管理风格预设”手动添加。",
        activeText: "当前固定风格",
    },
    character: {
        key: "characterAppearance",
        activeKey: "",
        summarySelector: "#oair_character_library_summary",
        title: "人物库",
        nameLabel: "人物名",
        bodyLabel: "外貌设定",
        emptyText: "还没有人物预设。可手动添加，或从对话/世界书提取。",
        activeText: "",
    },
    scene: {
        key: "sceneLibrary",
        activeKey: "sceneActive",
        summarySelector: "#oair_scene_library_summary",
        title: "场景库",
        nameLabel: "场景名",
        bodyLabel: "场景设定",
        emptyText: "还没有场景预设。可手动添加，或从对话/世界书提取。",
        activeText: "当前固定场景",
    },
};

function getLibraryConfig(kind) {
    return LIBRARY_CONFIGS[kind] || LIBRARY_CONFIGS.character;
}

function commitLibrary(kind, items, activeName = null) {
    const cfg = getLibraryConfig(kind);
    const visual = getEffectiveVisualSettings();
    const names = new Set((items || []).map((item) => String(item?.name || "").trim()).filter(Boolean));
    const patch = { [cfg.key]: serializeNamedLibrary(items) };
    if (cfg.activeKey) {
        if (activeName != null) {
            patch[cfg.activeKey] = names.has(activeName) ? activeName : "";
        } else if (visual[cfg.activeKey] && !names.has(visual[cfg.activeKey])) {
            patch[cfg.activeKey] = "";
        }
    }
    saveCurrentChatVisualScopePatch(patch);
    updateLibraryHiddenFields(kind);
    renderLibrarySummary(kind);
    updateVisualScopeStatus();
}

function updateLibraryHiddenFields(kind) {
    const cfg = getLibraryConfig(kind);
    const s = getEffectiveVisualSettings();
    const fp = $("#oair_floating_panel");
    fp.find(`#oair_${cfg.key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`).val(s[cfg.key] || "");
    if (cfg.activeKey) {
        fp.find(`#oair_${cfg.activeKey.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)}`).val(s[cfg.activeKey] || "");
    }
}

function renderAllLibrarySummaries() {
    renderBuiltInStylePresets();
    renderLibrarySummary("style");
    renderLibrarySummary("character");
    renderLibrarySummary("scene");
}

function renderBuiltInStylePresets() {
    const fp = $("#oair_floating_panel");
    const box = fp.find("#oair_builtin_style_presets");
    if (!box.length) return;
    box.empty();
    for (const preset of BUILT_IN_STYLE_PRESETS) {
        const card = $("<div>").addClass("oair-built-in-style");
        $("<div>").addClass("oair-built-in-style-name").text(preset.name).appendTo(card);
        $("<div>").addClass("oair-built-in-style-text").text(preset.text).appendTo(card);
        card.appendTo(box);
    }
}

function importBuiltInStylesIntoCurrentCard() {
    const scope = loadCurrentChatVisualScope(extension_settings[extensionName]);
    const merged = mergeBuiltInStylePresets(scope.values.styleLibrary || "");
    if (!merged.changed) {
        toastr.info("内置风格已在当前角色卡风格库中。");
        setStatus("内置风格无需重复导入", "info");
        return;
    }
    saveCurrentChatVisualScopePatch({ styleLibrary: merged.text });
    updateLibraryHiddenFields("style");
    renderAllLibrarySummaries();
    updateVisualScopeStatus();
    const count = merged.added.length;
    toastr.success(`已导入 ${count} 个内置风格到当前角色卡。`);
    setStatus(`已导入 ${count} 个内置风格`, "success");
}

function renderLibrarySummary(kind) {
    const cfg = getLibraryConfig(kind);
    const s = getEffectiveVisualSettings();
    const fp = $("#oair_floating_panel");
    const box = fp.find(cfg.summarySelector);
    if (!box.length) return;

    const items = parseNamedLibrary(s[cfg.key]);
    const active = cfg.activeKey ? String(s[cfg.activeKey] || "").trim() : "";
    box.empty();

    if (!items.length) {
        $("<div>").addClass("oair-library-empty").text(cfg.emptyText).appendTo(box);
        return;
    }

    for (const item of items.slice(0, 4)) {
        const card = $("<div>").addClass("oair-library-card");
        const title = $("<div>").addClass("oair-library-card-title").appendTo(card);
        $("<span>").text(item.name).appendTo(title);
        if (active && item.name === active) {
            $("<span>").addClass("oair-active-chip").text("当前").appendTo(title);
        }
        $("<div>").addClass("oair-library-card-body").text(item.body).appendTo(card);
        card.appendTo(box);
    }

    if (items.length > 4) {
        $("<div>")
            .addClass("oair-hint")
            .text(`共 ${items.length} 条，已显示前 4 条。点击管理查看完整列表。`)
            .appendTo(box);
    } else {
        $("<div>").addClass("oair-hint").text(`共 ${items.length} 条。`).appendTo(box);
    }
}

function clearLibrary(kind) {
    const cfg = getLibraryConfig(kind);
    const s = getEffectiveVisualSettings();
    const count = parseNamedLibrary(s[cfg.key]).length;
    const activeValue = cfg.activeKey ? String(s[cfg.activeKey] || "").trim() : "";
    const hasConfirmedCharacters = kind === "character"
        && (Array.isArray(s.confirmedCharacters)
            ? s.confirmedCharacters.length > 0
            : !!String(s.confirmedCharacters || "").trim());
    const hasAssociatedState = !!activeValue || hasConfirmedCharacters;
    if (!count && !hasAssociatedState) {
        toastr.warning(`${cfg.title}已经是空的。`);
        return;
    }
    const clearTarget = count ? `中的 ${count} 条预设` : "的关联状态";
    if (!window.confirm(`清空${cfg.title}${clearTarget}？此操作只清空当前角色卡库文本和关联选择，不会删除世界书或聊天记录。`)) return;

    const patch = { [cfg.key]: "" };
    if (cfg.activeKey) {
        patch[cfg.activeKey] = "";
    }
    if (kind === "character") {
        patch.confirmedCharacters = [];
    }
    saveCurrentChatVisualScopePatch(patch);
    updateLibraryHiddenFields(kind);
    renderLibrarySummary(kind);
    updateVisualScopeStatus();
    toastr.success(`${cfg.title}已清空。`);
    setStatus(`${cfg.title}已清空`, "success");
}

function openLibraryModal(kind) {
    const cfg = getLibraryConfig(kind);
    const s = getEffectiveVisualSettings();
    let items = parseNamedLibrary(s[cfg.key]);
    let active = cfg.activeKey ? String(s[cfg.activeKey] || "").trim() : "";
    let selected = items.length ? 0 : -1;

    $(document).off("keydown.oair_library_modal");
    $("#oair_library_modal").remove();
    const modal = $('<div id="oair_library_modal" class="oair-library-modal oair-visible"></div>');
    const dialog = $('<div class="oair-library-dialog"></div>').appendTo(modal);
    const header = $('<div class="oair-library-dialog-header"></div>').appendTo(dialog);
    $("<h3>").addClass("oair-library-dialog-title").text(cfg.title).appendTo(header);
    $('<button type="button" class="oair-floating-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>')
        .on("click", close)
        .appendTo(header);

    const body = $('<div class="oair-library-dialog-body"></div>').appendTo(dialog);
    const list = $('<div class="oair-library-list"></div>').appendTo(body);
    const editor = $('<div class="oair-library-editor"></div>').appendTo(body);
    $("<label>").addClass("oair-field-label").text(cfg.nameLabel).appendTo(editor);
    const nameInput = $('<input class="text_pole" style="width:100%; box-sizing:border-box;">').appendTo(editor);
    $("<label>").addClass("oair-field-label").text(cfg.bodyLabel).appendTo(editor);
    const bodyInput = $('<textarea class="text_pole" style="width:100%; box-sizing:border-box;"></textarea>').appendTo(editor);
    $("<div>").addClass("oair-hint").text("预设按“名字：描述”存储；旧数据会自动显示在这里。").appendTo(editor);

    const editButtons = $('<div class="oair-btn-row"></div>').appendTo(editor);
    $('<button type="button" class="menu_button" style="flex:1; justify-content:center;">新增</button>')
        .on("click", () => {
            selected = -1;
            nameInput.val("");
            bodyInput.val("");
            renderList();
            nameInput.trigger("focus");
        })
        .appendTo(editButtons);
    $('<button type="button" class="menu_button" style="flex:1; justify-content:center;">保存条目</button>')
        .on("click", () => {
            const name = String(nameInput.val() || "").trim();
            const bodyText = String(bodyInput.val() || "").trim();
            if (!name || !bodyText) {
                toastr.warning("请填写名字和描述。");
                return;
            }
            if (selected >= 0 && items[selected]) {
                const oldName = items[selected].name;
                items[selected] = { name, body: bodyText, raw: `${name}：${bodyText}` };
                if (active === oldName) active = name;
            } else {
                const existing = items.findIndex((item) => item.name === name);
                if (existing >= 0) {
                    items[existing] = { name, body: bodyText, raw: `${name}：${bodyText}` };
                    selected = existing;
                } else {
                    items.push({ name, body: bodyText, raw: `${name}：${bodyText}` });
                    selected = items.length - 1;
                }
            }
            commitLibrary(kind, items, active);
            items = parseNamedLibrary(getEffectiveVisualSettings()[cfg.key]);
            renderList();
            loadEditor(selected);
            toastr.success("预设已保存。");
        })
        .appendTo(editButtons);

    const footer = $('<div class="oair-library-dialog-footer"></div>').appendTo(dialog);
    $('<button type="button" class="menu_button">关闭</button>').on("click", close).appendTo(footer);

    function close() {
        $(document).off("keydown.oair_library_modal");
        modal.removeClass("oair-visible").remove();
    }

    function loadEditor(index) {
        selected = index;
        const item = items[index];
        nameInput.val(item?.name || "");
        bodyInput.val(item?.body || "");
    }

    function selectLibraryRow(index) {
        if (!items[index]) return;
        selected = index;
        renderList();
        loadEditor(index);
    }

    function isLibraryRowInteractiveTarget(event) {
        return $(event.target).closest("button,input,textarea,select,a,label").length > 0;
    }

    function renderList() {
        list.empty();
        if (!items.length) {
            $("<div>").addClass("oair-library-empty").text(cfg.emptyText).appendTo(list);
            return;
        }
        items.forEach((item, index) => {
            const row = $("<div>")
                .addClass("oair-library-row")
                .attr({ tabindex: 0, role: "button", "aria-label": `${cfg.title}：${item.name}` })
                .toggleClass("oair-active", index === selected);
            const title = $("<div>").addClass("oair-library-row-title").appendTo(row);
            $("<span>").text(item.name).appendTo(title);
            if (cfg.activeKey && active === item.name) {
                $("<span>").addClass("oair-active-chip").text("当前").appendTo(title);
            }
            $("<div>").addClass("oair-library-row-body").text(item.body).appendTo(row);
            const actions = $("<div>").addClass("oair-library-row-actions").appendTo(row);
            $('<button type="button" class="menu_button">编辑</button>')
                .on("click", (e) => { e.stopPropagation(); selectLibraryRow(index); })
                .appendTo(actions);
            if (cfg.activeKey) {
                $('<button type="button" class="menu_button">设为当前</button>')
                    .on("click", (e) => {
                        e.stopPropagation();
                        active = item.name;
                        commitLibrary(kind, items, active);
                        renderList();
                    })
                    .appendTo(actions);
            }
            $('<button type="button" class="menu_button">删除</button>')
                .on("click", (e) => {
                    e.stopPropagation();
                    if (!confirm(`删除「${item.name}」？`)) return;
                    if (active === item.name) active = "";
                    items.splice(index, 1);
                    selected = Math.min(index, items.length - 1);
                    commitLibrary(kind, items, active);
                    renderList();
                    loadEditor(selected);
                })
                .appendTo(actions);
            row.on("click", (e) => {
                if (isLibraryRowInteractiveTarget(e)) return;
                selectLibraryRow(index);
            });
            row.on("keydown", (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectLibraryRow(index);
                }
            });
            row.appendTo(list);
        });
    }

    renderList();
    loadEditor(selected);
    $("body").append(modal);
    $(document).off("keydown.oair_library_modal").on("keydown.oair_library_modal", (e) => {
        if (e.key === "Escape") {
            $(document).off("keydown.oair_library_modal");
            close();
        }
    });
}

async function extractLibraryFromChat(kind) {
    const cfg = getLibraryConfig(kind);
    const s = getEffectiveVisualSettings();
    const source = collectRecentChatText(8);
    if (!source.trim()) {
        toastr.warning("没有可提取的对话内容。");
        return;
    }

    const buttonSelector = kind === "character" ? "#oair_btn_character_from_chat" : "#oair_btn_scene_from_chat";
    setButtonLoading(buttonSelector, true);
    setStatus(`正在从对话提取${cfg.title}...`, "info");

    try {
        const items = await extractNamedItemsWithLlm(kind, source);
        if (!items.length) {
            toastr.warning("未提取到可用预设。");
            return;
        }
        saveCurrentChatVisualScopePatch({ [cfg.key]: addNamedLibraryItems(s[cfg.key], items) });
        updateLibraryHiddenFields(kind);
        renderLibrarySummary(kind);
        openLibraryModal(kind);
        toastr.success(`已从对话提取 ${items.length} 条${cfg.title}预设，请在弹窗中检查/编辑。`);
        setStatus(`已提取 ${items.length} 条${cfg.title}预设`, "success");
    } catch (err) {
        console.error(`[${extensionName}] extract ${kind} from chat failed`, err);
        toastr.error(err.message || "对话提取失败。");
        setStatus(err.message || "对话提取失败", "error");
    } finally {
        setButtonLoading(buttonSelector, false);
    }
}

async function extractLibraryFromWorldBook(kind) {
    const cfg = getLibraryConfig(kind);
    const buttonSelector = kind === "character" ? "#oair_btn_character_from_worldbook" : "#oair_btn_scene_from_worldbook";
    setButtonLoading(buttonSelector, true);
    setStatus(`正在从世界书筛选${cfg.title}候选...`, "info");

    try {
        const candidates = await extractWorldBookCandidates(kind);
        if (!candidates.length) {
            toastr.warning(`世界书中没有筛选到高相关的${cfg.title}候选。`);
            setStatus("没有可用世界书候选", "warning");
            return;
        }
        openExtractionCandidateModal(kind, candidates);
        toastr.success(`已筛选出 ${candidates.length} 条${cfg.title}候选，请确认后再入库。`);
        setStatus(`已筛选 ${candidates.length} 条${cfg.title}候选`, "success");
    } catch (err) {
        console.error(`[${extensionName}] extract ${kind} from world book failed`, err);
        toastr.error(err.message || "世界书提取失败。");
        setStatus(err.message || "世界书提取失败", "error");
    } finally {
        setButtonLoading(buttonSelector, false);
    }
}

async function extractWorldBookCandidates(kind) {
    const s = extension_settings[extensionName];
    const entries = await loadActiveWorldBookEntries();
    const headings = String(s.worldBookSectionHeadings || "")
        .split(/[,，]/)
        .map((h) => h.trim())
        .filter(Boolean);
    return entries
        .map((entry) => classifyWorldBookEntry(entry, kind, headings))
        .filter((item) => item && item.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
}

function classifyWorldBookEntry(entry, kind, headings = []) {
    const name = String(entry?.comment || entry?.keys?.[0] || "").trim();
    const content = String(entry?.content || "").trim();
    if (!name || !content) return null;
    const lowerName = name.toLowerCase();
    const keyText = [name, ...(entry.keys || [])].join(" ").toLowerCase();
    const section = extractEntrySection(content, headings);
    const text = `${name}\n${section || content}`;

    const rejectWords = ["规则", "系统", "格式", "模板", "提示", "世界观", "背景", "剧情", "摘要", "说明", "组织", "阵营", "国家", "种族", "能力", "技能", "任务", "章节"];
    if (rejectWords.some((w) => lowerName.includes(w) || keyText.includes(w.toLowerCase()))) return null;

    const charWords = ["外貌", "长相", "外观", "发", "瞳", "眼", "身高", "体型", "服装", "裙", "甲", "饰品", "气质", "少年", "少女", "青年", "男人", "女人", "脸", "肤", "耳", "角", "尾"];
    const sceneWords = ["场景", "环境", "地点", "建筑", "房间", "街", "广场", "城", "镇", "村", "森林", "洞", "宫殿", "旅馆", "学校", "教堂", "光线", "天气", "陈设", "空间", "地形", "氛围", "门", "窗", "灯", "墙"];
    const words = kind === "scene" ? sceneWords : charWords;
    const antiWords = kind === "scene" ? charWords.slice(0, 8) : sceneWords.slice(0, 10);

    let score = 0;
    const reasons = [];
    const nameLen = [...name].length;
    if (nameLen >= 2 && nameLen <= 16) { score += 1; reasons.push("名称长度合理"); }
    for (const w of words) {
        if (text.includes(w)) { score += 1; reasons.push(`含${w}`); break; }
    }
    for (const h of headings) {
        if (!h) continue;
        const isCharHeading = charWords.some((w) => h.toLowerCase().includes(w.toLowerCase()) || w.includes(h));
        const isSceneHeading = sceneWords.some((w) => h.toLowerCase().includes(w.toLowerCase()) || w.includes(h));
        if ((kind === "character" && isCharHeading) || (kind === "scene" && isSceneHeading)) {
            if (content.includes(`${h}：`) || content.includes(`${h}:`)) { score += 1; reasons.push(`命中小节${h}`); break; }
        }
    }
    if (antiWords.some((w) => lowerName.includes(w) || keyText.includes(w.toLowerCase()))) score -= 1;
    if ([...section].length < 12) score -= 1;
    if ([...section].length > 500) score -= 1;

    if (score < 2) return null;
    return { name, body: section || content.slice(0, 300), score, reason: dedupeStrings(reasons).join("、") || "规则命中" };
}

function openExtractionCandidateModal(kind, candidates) {
    const cfg = getLibraryConfig(kind);
    let items = (candidates || []).map((item) => ({ ...item, checked: item.score >= 3 }));
    $(document).off("keydown.oair_extract_modal");
    $("#oair_extract_modal").remove();

    const modal = $('<div id="oair_extract_modal" class="oair-library-modal oair-visible"></div>');
    const dialog = $('<div class="oair-library-dialog"></div>').appendTo(modal);
    const header = $('<div class="oair-library-dialog-header"></div>').appendTo(dialog);
    $("<h3>").addClass("oair-library-dialog-title").text(`${cfg.title}提取候选`).appendTo(header);
    $('<button type="button" class="oair-floating-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>').on("click", close).appendTo(header);
    const body = $('<div class="oair-library-dialog-body" style="grid-template-columns:1fr;"></div>').appendTo(dialog);
    const list = $('<div class="oair-library-list"></div>').appendTo(body);
    const footer = $('<div class="oair-library-dialog-footer"></div>').appendTo(dialog);
    $('<button type="button" class="menu_button">取消</button>').on("click", close).appendTo(footer);
    $('<button type="button" class="menu_button">确认加入库</button>').on("click", () => {
        const selected = items.filter((item) => item.checked).map(({ name, body }) => ({ name, body }));
        if (!selected.length) {
            toastr.warning("请至少选择一条候选。");
            return;
        }
        const s = getEffectiveVisualSettings();
        saveCurrentChatVisualScopePatch({ [cfg.key]: addNamedLibraryItems(s[cfg.key], selected) });
        updateLibraryHiddenFields(kind);
        renderLibrarySummary(kind);
        close();
        openLibraryModal(kind);
        toastr.success(`已加入 ${selected.length} 条${cfg.title}预设。`);
    }).appendTo(footer);

    function close() {
        $(document).off("keydown.oair_extract_modal");
        modal.removeClass("oair-visible").remove();
    }

    function render() {
        list.empty();
        items.forEach((item, index) => {
            const row = $('<div class="oair-library-row"></div>').appendTo(list);
            const title = $('<div class="oair-library-row-title"></div>').appendTo(row);
            const check = $('<input type="checkbox">').prop("checked", !!item.checked).on("change", function () { item.checked = $(this).prop("checked"); }).appendTo(title);
            $("<span>").text(`评分 ${item.score} · ${item.reason || "候选"}`).appendTo(title);
            $('<label class="oair-field-label">名称</label>').appendTo(row);
            $('<input class="text_pole" style="width:100%; box-sizing:border-box;">').val(item.name).on("input", function () { item.name = String($(this).val() || "").trim(); }).appendTo(row);
            $('<label class="oair-field-label">描述</label>').appendTo(row);
            $('<textarea class="text_pole" rows="3" style="width:100%; box-sizing:border-box;"></textarea>').val(item.body).on("input", function () { item.body = String($(this).val() || "").trim(); }).appendTo(row);
            check.attr("aria-label", `选择候选 ${index + 1}`);
        });
    }

    render();
    $("body").append(modal);
    $(document).off("keydown.oair_extract_modal").on("keydown.oair_extract_modal", (e) => { if (e.key === "Escape") close(); });
}

function collectRecentChatText(limit = 8) {
    const ctx = getContext();
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const parts = [];
    for (let i = chat.length - 1; i >= 0 && parts.length < limit; i--) {
        const msg = chat[i];
        if (!msg || msg.is_system) continue;
        const text = cleanRpText(msg.mes || msg.content || "");
        if (text) parts.unshift(text);
    }
    return parts.join("\n\n");
}

async function extractNamedItemsWithLlm(kind, sourceText) {
    const isScene = kind === "scene";
    const systemPrompt = "你是 SillyTavern 生图设定库整理助手，只输出 JSON。";
    const userPrompt = [
        isScene
            ? "请从以下对话内容中提取可复用的场景/地点/环境预设。"
            : "请从以下对话内容中提取可复用的人物外貌预设。",
        "",
        "输出格式必须是紧凑 JSON：",
        '{"items":[{"name":"名字","body":"描述"}]}',
        "",
        "要求：",
        "1. name 必须短，适合作为预设名。",
        isScene
            ? "2. body 只写稳定环境特征，例如地点、空间结构、时间氛围、陈设、光线、天气，不写一次性动作。"
            : "2. body 只写稳定人物外貌，例如发型发色、瞳色、体型、服装、标志性饰品、气质，不写一次性动作。",
        "3. 没有明确可复用信息时输出 {\"items\":[]}",
        "4. 不要输出解释，不要代码块。",
        "",
        "对话内容：",
        sourceText,
    ].join("\n");
    const text = await callLlmForText(systemPrompt, userPrompt);
    return parseExtractItemsJson(text);
}

function parseExtractItemsJson(text) {
    const raw = String(text || "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    let obj = null;
    try { obj = JSON.parse(m[0]); } catch { return []; }
    const arr = Array.isArray(obj?.items) ? obj.items : [];
    return arr
        .map((item) => ({
            name: String(item?.name || "").trim(),
            body: String(item?.body || "").trim(),
        }))
        .filter((item) => item.name && item.body);
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
    const visualSettings = getEffectiveVisualSettings(s);
    const fp = $("#oair_floating_panel");
    if (!fp.length) return;
    lastRenderedVisualScopeKey = createChatVisualScopeKey(getCurrentChatVisualContext());

    // Status bar
    fp.find("#oair_floating_enabled").prop("checked", !!s.enabled);

    // 基础
    fp.find("#oair_message_gen_enabled").prop("checked", s.messageGenEnabled !== false);
    fp.find("#oair_summarize_template").val(s.summarizeTemplate || "");
    fp.find("#oair_automatic_flow_enabled").prop("checked", !!s.automaticFlowEnabled);
    fp.find("#oair_automatic_flow_follow_workbench").prop("checked", s.automaticFlowFollowWorkbench !== false);
    fp.find("#oair_automatic_flow_min_chars").val(Number(s.automaticFlowMinChars) || 0);
    fp.find("#oair_automatic_flow_failure_policy").val(normalizeAutomaticFlowFailurePolicy(s.automaticFlowFailurePolicy));
    fp.find("#oair_automatic_flow_show_queue").prop("checked", s.automaticFlowShowQueue !== false);
    fp.find("#oair_automatic_flow_cancel_enabled").prop("checked", s.automaticFlowCancelEnabled !== false);
    fp.find("#oair_multi_image_enabled").prop("checked", !!s.multiImageEnabled);
    fp.find("#oair_generation_mode").val(normalizeGenerationMode(s.generationMode));
    fp.find("#oair_default_beat_count").val(normalizeBeatCount(s.defaultBeatCount));
    fp.find("#oair_multi_image_failure_policy").val(normalizePlanFailurePolicy(s.multiImageFailurePolicy));
    fp.find("#oair_comic_panel_count").val(normalizeComicPanelCount(s.comicPanelCount));
    fp.find("#oair_comic_dialogue_enabled").prop("checked", s.comicDialogueEnabled !== false);
    fp.find("#oair_comic_dialogue_mode").val(normalizeComicDialogueMode(s.comicDialogueMode));
    fp.find("#oair_comic_failure_policy").val(normalizePlanFailurePolicy(s.comicFailurePolicy));
    fp.find("#oair_continuity_mode").val(normalizeContinuityMode(s.continuityMode));
    updateAutomaticQueueStatus();

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

    // 后端响应解析
    fp.find("#oair_response_image_regex").val(s.responseImageRegex || "");

    // 优化
    fp.find("#oair_optimize_enabled").prop("checked", !!s.optimizeEnabled);
    fp.find("#oair_optimize_auto").prop("checked", !!s.optimizeAuto);
    fp.find("#oair_optimize_template").val(s.optimizeTemplate || "");
    fp.find("#oair_multi_analysis_template").val(s.multiAnalysisTemplate || "");
    fp.find("#oair_comic_analysis_template").val(s.comicAnalysisTemplate || "");
    fp.find("#oair_analysis_template").val(s.analysisTemplate || "");
    fp.find("#oair_cleanup_template").val(s.cleanupTemplate || "");
    fp.find("#oair_single_image_strategy").val(normalizeSingleImageStrategy(s.singleImageStrategy));
    fp.find("#oair_visual_sanitization_level").val(normalizeVisualSanitizationLevel(s.visualSanitizationLevel));
    fp.find("#oair_prompt_safety_level").val(normalizePromptSafetyLevel(s.promptSafetyLevel));
    fp.find("#oair_text_max_tokens").val(s.textMaxTokens ?? 8192);
    fp.find("#oair_character_appearance").val(visualSettings.characterAppearance || "");
    fp.find("#oair_style_library").val(visualSettings.styleLibrary || "");
    fp.find("#oair_style_active").val(visualSettings.styleActive || "");
    fp.find("#oair_scene_library").val(visualSettings.sceneLibrary || "");
    fp.find("#oair_scene_active").val(visualSettings.sceneActive || "");
    updateVisualScopeStatus();
    fp.find("#oair_style_auto_select").prop("checked", !!s.styleAutoSelect);
    fp.find("#oair_character_llm_extract").prop("checked", !!s.characterLlmExtract);
    fp.find("#oair_auto_extract_characters").prop("checked", !!s.autoExtractCharactersEnabled);
    fp.find("#oair_auto_extract_scenes").prop("checked", !!s.autoExtractScenesEnabled);
    fp.find("#oair_scene_auto_select").prop("checked", !!s.sceneAutoSelect);
    fp.find(`input[name="oair_character_worldbook_mode"][value="${libraryWorldBookMode(s, "character")}"]`).prop("checked", true);
    fp.find(`input[name="oair_scene_worldbook_mode"][value="${libraryWorldBookMode(s, "scene")}"]`).prop("checked", true);
    renderBuiltInStylePresets();
    renderAllLibrarySummaries();
    fp.find("#oair_worldbook_headings").val(s.worldBookSectionHeadings || "");
    fp.find("#oair_worldbook_maxchars").val(s.worldBookMaxChars ?? 800);
    fp.find("#oair_optimize_use_custom").prop("checked", !!s.optimizeUseCustom);
    fp.find("#oair_custom_backend_fields").toggleClass("oair-visible", !!s.optimizeUseCustom);
    fp.find("#oair_optimize_api_url").val(s.optimizeApiUrl || "");
    fp.find("#oair_optimize_model").val(s.optimizeModel || "");
    fp.find("#oair_optimize_api_key").val(s.optimizeApiKey || "");

    // 安全重写
    fp.find("#oair_nsfw_avoidance").prop("checked", !!s.nsfwAvoidance);
    fp.find("#oair_nsfw_avoidance_template").val(s.nsfwAvoidanceTemplate || "");
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: MAIN PROMPT INJECTION & STATUS
// ═══════════════════════════════════════════════════════════════

function normalizeTemplateText(text) {
    return String(text || "").replace(/\r\n/g, "\n").trim();
}

function normalizeStyleLibrarySetting(settings) {
    if (!String(settings.styleLibrary || "").trim()) {
        settings.styleLibrary = DEFAULT_STYLE_LIBRARY;
    }
}

function normalizeOptimizeTemplateSetting(settings) {
    const template = String(settings.optimizeTemplate || "");
    const isOldDefaultTemplate = LEGACY_OPTIMIZE_TEMPLATES.some((legacy) =>
        normalizeTemplateText(template) === normalizeTemplateText(legacy),
    );
    const looksLikeOldDefaultTemplate = !/本地提示词编译器|编译后提示词|精修编辑/.test(template)
        && LEGACY_OPTIMIZE_TEMPLATE_MARKERS.some((marker) => template.includes(marker))
        && /{{\s*prompt\s*}}/.test(template);
    if (!template.trim() || isOldDefaultTemplate || looksLikeOldDefaultTemplate) {
        settings.optimizeTemplate = DEFAULT_OPTIMIZE_TEMPLATE;
    }
}

function normalizeSafetyTemplateSetting(settings) {
    const template = String(settings.nsfwAvoidanceTemplate || "");
    const looksLikeOldDefaultTemplate = !/安全级别|{{\s*safetyLevel\s*}}|安全重写专家/.test(template)
        && LEGACY_NSFW_TEMPLATE_MARKERS.some((marker) => template.includes(marker))
        && /{{\s*prompt\s*}}/.test(template);
    if (!template.trim() || looksLikeOldDefaultTemplate) {
        settings.nsfwAvoidanceTemplate = DEFAULT_NSFW_TEMPLATE;
    }
}

function ensureSettings() {
    const current = extension_settings[extensionName] || {};
    const hadWorldBookMode = Object.prototype.hasOwnProperty.call(current, "worldBookMode");
    const hadCharacterMode = Object.prototype.hasOwnProperty.call(current, "characterWorldBookMode");
    const hadSceneMode = Object.prototype.hasOwnProperty.call(current, "sceneWorldBookMode");
    extension_settings[extensionName] = {
        ...structuredClone(defaultSettings),
        ...current,
    };
    const settings = extension_settings[extensionName];
    if (!hadWorldBookMode && current.worldBookEnabled === true) {
        settings.worldBookMode = "inject";
    }
    normalizeWorldBookModes(settings, { hadCharacterMode, hadSceneMode });
    settings.singleImageStrategy = normalizeSingleImageStrategy(settings.singleImageStrategy);
    settings.visualSanitizationLevel = normalizeVisualSanitizationLevel(settings.visualSanitizationLevel);
    settings.promptCompilerEnabled = settings.promptCompilerEnabled !== false;
    settings.promptSafetyLevel = normalizePromptSafetyLevel(settings.promptSafetyLevel);
    Object.assign(settings, normalizeAutomaticFlowSettings(settings));
    Object.assign(settings, normalizeVisualExtractionSettings(settings));
    settings.defaultBeatCount = normalizeBeatCount(settings.defaultBeatCount);
    settings.multiImageFailurePolicy = normalizePlanFailurePolicy(settings.multiImageFailurePolicy);
    settings.splitStrategy = ["auto", "fixed"].includes(String(settings.splitStrategy || "")) ? String(settings.splitStrategy) : "auto";
    // 迁移：Phase 4 只有 multiImageEnabled 开关；用户存档没有 generationMode 时按旧开关推导
    if (!Object.prototype.hasOwnProperty.call(current, "generationMode") && current.multiImageEnabled === true) {
        settings.generationMode = "multi";
    }
    settings.generationMode = normalizeGenerationMode(settings.generationMode);
    settings.multiImageEnabled = settings.generationMode === "multi";
    settings.comicPanelCount = normalizeComicPanelCount(settings.comicPanelCount);
    settings.comicDialogueMode = normalizeComicDialogueMode(settings.comicDialogueMode);
    settings.comicFailurePolicy = normalizePlanFailurePolicy(settings.comicFailurePolicy);
    if (!String(settings.comicAnalysisTemplate || "").trim()) {
        settings.comicAnalysisTemplate = DEFAULT_COMIC_ANALYSIS_TEMPLATE;
    }
    normalizeStyleLibrarySetting(settings);
    normalizeOptimizeTemplateSetting(settings);
    normalizeSafetyTemplateSetting(settings);
}

function applyMainPromptInjection() {
    // 旧版图片标签主模型注入已移除；这里只清空同 key 的遗留提示。
    setExtensionPrompt(mainPromptKey, "", extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
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

    console.log(`[${extensionName}] [状态] ${text}`);
}

function getMessageBlockElement(messageId) {
    const wanted = String(messageId);
    return Array.from(document.querySelectorAll("#chat [mesid]"))
        .find((element) => element.getAttribute("mesid") === wanted) || null;
}

function sleepForMessageBlock(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMessageBlock(messageId, attempts = 15, delayMs = 100) {
    for (let i = 0; i < attempts; i++) {
        const element = getMessageBlockElement(messageId);
        if (element) return element;
        await sleepForMessageBlock(delayMs);
    }
    return null;
}

function isHostMissingMessageBlockError(error) {
    const message = String(error?.message || "");
    const stack = String(error?.stack || "");
    return message.includes("getAttribute")
        && (stack.includes("ReasoningHandler.initHandleMessage") || stack.includes("updateReasoningUI"));
}

async function updateMessageBlockWhenReady(messageId, message, options = {}) {
    const element = await waitForMessageBlock(messageId);
    if (!element) {
        console.warn(`[${extensionName}] updateMessageBlock skipped: message block not ready`, messageId);
        return false;
    }

    try {
        updateMessageBlock(messageId, message, options);
        return true;
    } catch (error) {
        if (isHostMissingMessageBlockError(error)) {
            console.warn(`[${extensionName}] updateMessageBlock host reasoning UI skipped`, error);
            return false;
        }
        throw error;
    }
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

    throw new Error("无法调用文本模型：请确认 SillyTavern 已连接可用的聊天 API，或在「模型后端」勾选并填写自定义精修后端。");
}

/**
 * 通过酒馆主模型生成纯文本（用于编译后精修 / 安全重写 / 消息总结）。
 * generateRaw 不带聊天上下文，最适合"输入提示词→输出文本"的转换。
 * 兼容新版对象参数签名与旧版位置参数签名；generateRaw 不可用时返回 null。
 */
async function callMainLlm(systemPrompt, userPrompt) {
    const context = getContext();
    const generateRaw = context?.generateRaw;
    if (typeof generateRaw !== "function") {
        return null;
    }

    const settings = extension_settings[extensionName];
    // 文本精修/审查/总结的回复长度上限（可配置）。推理模型(glm/o1 等)的 max_tokens 需同时覆盖
    // 「思考 + 最终答案」，太小（如 1500）会让思考吃光预算、最终提示词被截断 → 质量很低；
    // 太大（如继承主模型的 65535）某些 glm 代理会挂起/拒绝。默认 8192，用户可在「优化」tab 调整。
    const responseLength = Number(settings.textMaxTokens) || 8192;

    // generateRaw 自身无超时。在重世界书 + ST-Prompt-Template 钩子的环境里，这次请求会被注入
    // 大量世界书条目，若后端挂起则 await 永不返回，UI 会永久卡在"正在优化…"。用超时兜底：超时即抛错，
    // 让上层（optimize/sanitize/summarize）优雅降级，而不是冻结界面。
    const timeoutMs = Math.min(120000, Number(settings.timeoutMs) || 120000);

    const invoke = (generateRaw.length === 0)
        // 新版酒馆：generateRaw({ prompt, systemPrompt, responseLength, ... })，唯一形参带默认值 → length 为 0
        ? generateRaw({ prompt: userPrompt, systemPrompt, responseLength })
        // 旧版酒馆：位置参数 generateRaw(prompt, api, instructOverride, quietToLoud, systemPrompt, responseLength)
        : generateRaw(userPrompt, null, false, false, systemPrompt, responseLength);

    let timer;
    try {
        return await Promise.race([
            invoke,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`文本模型 ${Math.round(timeoutMs / 1000)}s 内无响应（已超时）。若角色卡含大量世界书/JS 模板，建议在「模型后端」勾选「使用自定义精修 LLM 后端」走独立后端。`)),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
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
        max_tokens: Number(settings.textMaxTokens) || 8192,
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

function summarizeLogText(text, maxChars = 120) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "空";
    return value.length > maxChars ? `${value.slice(0, maxChars)}...（${value.length} 字符）` : `${value}（${value.length} 字符）`;
}

/**
 * 使用 LLM 精修编译后的提示词
 */
async function optimizePrompt(prompt, fixed = null) {
    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) return prompt;

    const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
    const systemPrompt = "你是一个专业的图片提示词精修编辑。";
    const userMessage = optimizeHasSlots(template)
        ? renderOptimizeTemplate(template, {
            prompt,
            style: fixed?.styleText,
            characters: fixed?.charactersText,
            scenes: fixed?.scenesText,
            singleStrategy: settings.singleImageStrategy,
        })
        : renderPrompt(template, prompt);

    try {
        console.log(`[${extensionName}] 精修提示词输入摘要：${summarizeLogText(userMessage)}`);
        const result = await callLlmForText(systemPrompt, userMessage);
        const optimized = result || prompt;
        console.log(`[${extensionName}] 精修提示词输出摘要：${summarizeLogText(optimized)}`);
        return optimized;
    } catch (error) {
        console.warn(`[${extensionName}] Prompt optimization failed, using original`, error);
        return prompt;
    }
}

/**
 * 安全重写 — 使用 LLM 对最终提示词做分级 SFW 处理
 */
async function sanitizePrompt(prompt) {
    const settings = extension_settings[extensionName];
    if (!settings.nsfwAvoidance) return prompt;

    const template = settings.nsfwAvoidanceTemplate || defaultSettings.nsfwAvoidanceTemplate;
    const systemPrompt = "你是一个图片提示词安全重写专家。";
    const safetyLevel = normalizePromptSafetyLevel(settings.promptSafetyLevel);
    const userMessage = renderSafetyTemplate(template, prompt, safetyLevel);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] NSFW sanitization failed, using original prompt`, error);
        return prompt;
    }
}

/**
 * 旧入口提示词处理流水线：原始 → 精修 → 安全重写。
 * 新的单图/多图/漫画入口会先规划并编译，再调用 finalizeCompiledJobPrompt。
 * @param {string} prompt - 原始提示词
 * @param {object} options - { forceOptimize: boolean, skipOptimize: boolean, skipFixedAppend: boolean }
 */
async function processPromptPipeline(prompt, options = {}) {
    const settings = extension_settings[extensionName];

    // Step 0: 收集固定设定（风格 + 人物）
    const fixed = options.fixed || await resolveFixedSettings(prompt, settings);

    // Step 1: 精修（启用且满足条件时）
    const shouldOptimize = !options.skipOptimize && (options.forceOptimize || settings.optimizeAuto);
    const optimizeActive = settings.optimizeEnabled && shouldOptimize;
    let injected = false;
    if (optimizeActive) {
        setStatus("正在精修提示词...", "info");
        const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
        if (optimizeHasSlots(template)) {
            prompt = await optimizePrompt(prompt, fixed);   // 固定设定与单图取景策略融进精修模板
            injected = optimizeHasFixedReferenceSlots(template);
        } else {
            prompt = await optimizePrompt(prompt, null);     // 老模板无占位符 → 优化后再拼接
        }
    }

    // Step 2: 安全重写（如果启用）
    if (settings.nsfwAvoidance) {
        setStatus("正在安全重写...", "info");
        prompt = await sanitizePrompt(prompt);
    }

    // Step 3: 未注入到模板的固定设定 → 末尾拼【设定参考】块
    if (!injected && !options.skipFixedAppend) {
        prompt = appendFixedBlock(prompt, fixed);
    }

    return prompt;
}

function dedupeLocalStrings(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function normalizeVisualSanitizationLevel(value) {
    const key = String(value || "").trim();
    return ["strict", "standard", "loose"].includes(key) ? key : "standard";
}

function isPollutedReferenceLine(line, level = "standard") {
    const text = String(line || "").trim();
    if (!text) return true;
    if (/[<%][\s\S]*[_%>]/.test(text) || /<%_|_%>|getMessageVar|TavernDB|Wrapper|WrapperStart|WrapperEnd|readableData|_.cloneDeep|const\s+|let\s+|var\s+|function\s*\(/i.test(text)) return true;
    if (/插图插入|任务规则|任务确认|按要求插入|now_plot|system prompt|prompt-template|状态栏|变量|数据库|配置项|规则说明|不是视觉设定|workflow|instruction/i.test(text)) return true;
    if (/^[-*_`~|\s:：]+$/.test(text)) return true;
    if (level === "strict" && /^[⚙️#>\-\*\s]*(规则|设定规则|强化|任务|系统|配置|模板|宏|脚本|插入)\s*[：:]/.test(text)) return true;
    if (level !== "loose" && /^[⚙️#>\-\*\s]*(规则|任务|系统|配置|模板|宏|脚本|插入|强化)\s*[：:]/.test(text)) return true;
    return false;
}

function stripReferenceNoise(line) {
    return String(line || "")
        .replace(/<%_[\s\S]*?_%>/g, "")
        .replace(/TavernDB[-\w]*|Wrapper(?:Start|End)?[-\w]*|getMessageVar\([^)]*\)/gi, "")
        .replace(/^[\s>*#\-]+/, "")
        .trim();
}

function hasCharacterVisualValue(text) {
    return /发|瞳|眼|脸|肤|身高|体型|体态|年龄|气质|服装|衣|裙|袍|甲|披风|饰|装备|武器|表情|姿态|妆|外貌|外观|长相|耳|尾|角|翼|色/.test(String(text || ""));
}

function hasSceneVisualValue(text) {
    return /地点|场景|环境|广场|街|巷|城|镇|村|室|房|厅|宫|塔|森林|山|海|河|湖|天空|地面|石板|喷泉|建筑|灯|光|影|天气|雨|雪|雾|风|夜|昼|黄昏|清晨|氛围|人群|空间|布局|前景|中景|远景|地标|招牌|网格|WARNING|色|红|蓝|金|银/.test(String(text || ""));
}

function extractCharacterReferenceFromTableLine(line) {
    const text = String(line || "").trim();
    if (!/^\|.*\|$/.test(text)) return "";
    const cols = text.split("|").map((c) => c.trim()).filter(Boolean);
    if (cols.length < 3) return "";
    const name = cols[0].replace(/[*_`]/g, "").trim();
    const appearance = cols.slice(1).find((c) => /外貌|外观|长相|发|瞳|眼|脸|服|衣|裙|袍|体型|气质|表情|披风/.test(c));
    if (!name || !appearance || /名称|名字|角色|人物/.test(name) || !hasCharacterVisualValue(appearance)) return "";
    return `${name}：${appearance.replace(/^外貌\s*[：:]/, "").trim()}`;
}

function sanitizeVisualReferenceText(text, { kind = "generic", level = "standard" } = {}) {
    const mode = normalizeVisualSanitizationLevel(level);
    const lines = String(text || "").split(/\r?\n/);
    const out = [];
    for (const rawLine of lines) {
        const line = stripReferenceNoise(rawLine);
        if (isPollutedReferenceLine(line, mode)) continue;
        if (kind === "scene" && /^\|.*\|$/.test(line)) continue;
        if (kind === "character") {
            const tableRef = extractCharacterReferenceFromTableLine(line);
            if (tableRef) {
                out.push(tableRef);
                continue;
            }
        }
        if (kind === "character" && !hasCharacterVisualValue(line)) continue;
        if (kind === "scene" && !hasSceneVisualValue(line)) continue;
        out.push(line);
    }
    return dedupeLocalStrings(out).join("\n").trim();
}

function sanitizeCharacterReferenceText(text, level = "standard", fallbackName = "") {
    const cleaned = sanitizeVisualReferenceText(text, { kind: "character", level });
    const out = [];
    for (const line of cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        const m = line.match(/^([^：:|]{1,24})[：:]\s*(.+)$/);
        if (m) {
            const name = m[1].trim();
            const body = m[2].trim();
            if (name && body && hasCharacterVisualValue(body)) out.push(`${name}：${body}`);
        } else if (fallbackName && hasCharacterVisualValue(line)) {
            out.push(`${fallbackName}：${line}`);
        }
    }
    return dedupeLocalStrings(out).join("\n");
}

function sanitizeSceneReferenceText(text, level = "standard") {
    const cleaned = sanitizeVisualReferenceText(text, { kind: "scene", level });
    const out = [];
    for (const line of cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        if (/^([^：:|]{1,24})[：:]\s*(.+)$/.test(line) || hasSceneVisualValue(line)) out.push(line);
    }
    return dedupeLocalStrings(out).join("\n");
}

function logSanitizationSummary(kind, beforeItems, afterItems, level) {
    const before = (beforeItems || []).filter((item) => String(item?.text || "").trim()).length;
    const after = (afterItems || []).filter((item) => String(item?.text || "").trim()).length;
    if (before !== after) {
        console.log(`[${extensionName}] 设定清洗(${kind}/${normalizeVisualSanitizationLevel(level)})：保留 ${after}/${before} 条，已过滤 ${before - after} 条污染或低视觉价值内容。`);
    }
}

function renderSafetyTemplate(template, prompt, safetyLevel = "standard") {
    return renderPrompt(template, prompt)
        .replace(/\{\{\s*safetyLevel\s*\}\}/g, normalizePromptSafetyLevel(safetyLevel));
}

function parseCharacterReferenceItems(text) {
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
        const m = line.trim().match(/^([^：:|]{1,40})[：:]\s*(.+)$/);
        if (!m) continue;
        const name = m[1].trim();
        const body = m[2].trim();
        if (name && body) out.push({ name, text: body });
    }
    return out;
}

function createCharacterCandidate(input = {}) {
    const name = String(input.name || "").trim();
    let text = String(input.text || input.body || "").trim();
    text = text.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[：:]\\s*`), "").trim();
    return {
        id: String(input.id || `char_${name || Math.random().toString(36).slice(2)}`),
        name,
        text,
        source: String(input.source || "story"),
        stable: !!input.stable,
        selected: input.selected !== false,
    };
}

function collectCharacterCandidatesForWorkbench(sourceText, settings = {}, options = {}) {
    const source = String(sourceText || "");
    const seen = new Set();
    const candidates = [];
    const push = (candidate) => {
        const item = createCharacterCandidate(candidate);
        if (!item.name || !item.text || seen.has(item.name)) return;
        seen.add(item.name);
        candidates.push(item);
    };

    const librarySource = settings.__visualScopeSources?.characterAppearance === "legacy" ? "legacy" : "library";
    for (const item of parseCharacterReferenceItems(settings.characterAppearance)) {
        if (source && !source.includes(item.name)) continue;
        push({ ...item, source: librarySource, stable: true, selected: true });
    }

    for (const item of options.storyCandidates || []) {
        push({
            name: item.name,
            text: item.text || item.body,
            source: item.source || "story",
            stable: !!item.stable,
            selected: item.selected !== false,
        });
    }

    return candidates;
}

function normalizeConfirmedCharacterReferences(candidates = []) {
    const out = [];
    const seen = new Set();
    for (const candidate of candidates || []) {
        if (!candidate || candidate.selected === false) continue;
        const item = createCharacterCandidate(candidate);
        if (!item.name || !item.text || seen.has(item.name)) continue;
        seen.add(item.name);
        out.push({
            name: item.name,
            text: item.text,
            source: item.source,
            stable: !!item.stable,
        });
    }
    return out;
}

function applyConfirmedCharacterReferences(options = {}, confirmed = []) {
    const refs = normalizeConfirmedCharacterReferences(confirmed);
    if (!refs.length) return { ...options, confirmedCharacters: [] };
    const fixed = { ...(options.fixed || {}) };
    fixed.characters = refs.map((item) => `${item.name}: ${item.text}`).join("\n");
    fixed.charactersText = refs.map((item) => `${item.name}：${item.text}`).join("\n");
    return {
        ...options,
        fixed,
        confirmedCharacters: refs,
    };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7.5: IMAGE PLAN / IMAGE JOB（规划层骨架）
// ═══════════════════════════════════════════════════════════════

const IMAGE_JOB_STATUSES = ["pending", "running", "succeeded", "failed", "cancelRequested"];
let imagePlanSeq = 0;
let imageJobSeq = 0;

function createContinuityState(mode = "off", options = {}) {
    return {
        mode: String(mode || "off"),
        referenceImages: Array.isArray(options.referenceImages) ? [...options.referenceImages] : [],
        firstImage: String(options.firstImage || ""),
        previousImage: String(options.previousImage || ""),
    };
}

function createStoryBeat(input = {}) {
    return {
        index: Number(input.index) || 0,
        title: String(input.title || ""),
        visualMoment: String(input.visualMoment || ""),
        characters: coerceStringArray(input.characters),
        scene: String(input.scene || ""),
        actions: coerceStringArray(input.actions),
        anchors: coerceStringArray(input.anchors),
    };
}

function createComicPanel(input = {}) {
    return {
        index: Number(input.index) || 0,
        shotType: String(input.shotType || ""),
        imageDescription: String(input.imageDescription || ""),
        characters: coerceStringArray(input.characters),
        actions: coerceStringArray(input.actions),
        dialogue: coerceStringArray(input.dialogue, { dialogue: true }),
        caption: String(input.caption || ""),
        anchors: coerceStringArray(input.anchors),
    };
}

function createImageJob(input = {}) {
    const prompt = String(input.prompt || "").trim();
    return {
        id: String(input.id || `job_${++imageJobSeq}`),
        mode: String(input.mode || "single"),
        kind: String(input.kind || "text2image"),
        index: Number(input.index) || 0,
        title: String(input.title || ""),
        prompt,
        promptDiagnostics: input.promptDiagnostics && typeof input.promptDiagnostics === "object" ? { ...input.promptDiagnostics } : {},
        compiledPrompt: String(input.compiledPrompt || ""),
        refinedPrompt: String(input.refinedPrompt || ""),
        safetyPrompt: String(input.safetyPrompt || ""),
        sourceText: String(input.sourceText || prompt),
        characters: Array.isArray(input.characters) ? [...input.characters] : [],
        scene: String(input.scene || ""),
        anchors: Array.isArray(input.anchors) ? [...input.anchors] : [],
        promptParts: input.promptParts && typeof input.promptParts === "object" ? { ...input.promptParts } : null,
        promptDraft: input.promptDraft && typeof input.promptDraft === "object" ? { ...input.promptDraft } : null,
        dialogue: input.dialogue ?? null,
        dialogueMode: String(input.dialogueMode || input.promptDiagnostics?.dialogueMode || ""),
        caption: String(input.caption || ""),
        referenceImages: Array.isArray(input.referenceImages) ? [...input.referenceImages] : [],
        result: input.result || null,
        status: IMAGE_JOB_STATUSES.includes(input.status) ? input.status : "pending",
        error: String(input.error || ""),
        errorClass: String(input.errorClass || ""),
        errorSummary: String(input.errorSummary || ""),
        rawError: String(input.rawError || ""),
        retryable: !!input.retryable,
        policyRetryCount: Number(input.policyRetryCount) || 0,
        safeRetryPrompt: String(input.safeRetryPrompt || ""),
        policyOriginalPrompt: String(input.policyOriginalPrompt || ""),
        safetyRewritten: !!input.safetyRewritten,
        source: String(input.source || ""),
        requestedCount: Number(input.requestedCount) || 0,
        missingPlaceholder: !!input.missingPlaceholder,
        createdAt: Number(input.createdAt) || Date.now(),
        startedAt: Number(input.startedAt) || 0,
        finishedAt: Number(input.finishedAt) || 0,
        durationMs: Number(input.durationMs) || 0,
    };
}

function createImagePlan(input = {}) {
    const mode = String(input.mode || "single");
    return {
        id: String(input.id || `plan_${++imagePlanSeq}`),
        mode,
        sourceText: String(input.sourceText || ""),
        fixed: input.fixed || null,
        visualBible: input.visualBible || input.fixed?.visualBible || null,
        strategy: mode === "single" ? normalizeSingleImageStrategy(input.strategy) : String(input.strategy || ""),
        selectedTarget: input.selectedTarget || null,
        globalStyle: String(input.globalStyle || ""),
        characters: Array.isArray(input.characters) ? [...input.characters] : [],
        scenes: Array.isArray(input.scenes) ? [...input.scenes] : [],
        beats: Array.isArray(input.beats) ? input.beats.map((beat) => createStoryBeat(beat)) : [],
        panels: Array.isArray(input.panels) ? input.panels.map((panel) => createComicPanel(panel)) : [],
        continuity: input.continuity || createContinuityState(),
        failurePolicy: String(input.failurePolicy || "continue"),
        jobs: Array.isArray(input.jobs) ? input.jobs.map((job) => createImageJob(job)) : [],
    };
}

function compileJobPrompt(mode, jobInput = {}, fixed = null, options = {}) {
    const settings = extension_settings?.[extensionName] || defaultSettings;
    const fallback = String(jobInput.prompt || jobInput.promptParts?.visualMoment || jobInput.title || "").trim();
    if (settings.promptCompilerEnabled === false) {
        return {
            prompt: fallback,
            diagnostics: { mode, compiler: "disabled" },
        };
    }
    const compiled = compileImagePrompt({
        mode,
        fixed,
        visualBible: options.visualBible || fixed?.visualBible || null,
        dialogueEnabled: options.dialogueEnabled,
        strategy: options.strategy,
        job: jobInput,
    });
    return {
        prompt: compiled.prompt || fallback,
        diagnostics: compiled.diagnostics || {},
    };
}

function createSingleImagePlan(sourceText, options = {}) {
    const raw = String(sourceText || "").trim();
    const fixed = options.fixed || null;
    const visualBible = options.visualBible || fixed?.visualBible || null;
    const strategy = normalizeSingleImageStrategy(options.strategy || extension_settings?.[extensionName]?.singleImageStrategy);
    const selectedTarget = options.selectedTarget || planSingleImageTarget(raw, {
        strategy,
        fixed,
        characters: options.characters,
        analysisCharacters: options.analysisCharacters || fixed?.analysisCharacters || visualBible?.diagnostics?.analysisCharacters || [],
    });
    const jobInput = {
        mode: "single",
        title: options.title || selectedTarget.title || "单图",
        characters: selectedTarget.characters || options.characters || [],
        nonVisualCharacters: selectedTarget.nonVisualCharacters || [],
        scene: selectedTarget.scene || options.scene || "",
        anchors: selectedTarget.anchors || options.anchors || [],
        promptParts: selectedTarget,
    };
    const compiled = compileJobPrompt("single", jobInput, fixed, { strategy, visualBible });
    const prompt = String(options.prompt || compiled.prompt || raw).trim();
    const job = createImageJob({
        mode: "single",
        kind: "text2image",
        index: 0,
        title: jobInput.title,
        prompt,
        compiledPrompt: compiled.prompt,
        promptDiagnostics: compiled.diagnostics,
        sourceText: raw,
        characters: jobInput.characters,
        scene: jobInput.scene,
        anchors: jobInput.anchors,
        promptParts: jobInput.promptParts,
        referenceImages: options.referenceImages,
    });
    return createImagePlan({
        mode: "single",
        sourceText: raw,
        fixed,
        visualBible,
        strategy,
        selectedTarget,
        continuity: options.continuity || createContinuityState(extension_settings?.[extensionName]?.continuityMode),
        failurePolicy: options.failurePolicy || "stop",
        jobs: [job],
    });
}

function validateImageJob(job) {
    if (!job || typeof job !== "object") throw new Error("ImageJob 无效：不是对象。");
    if (!String(job.id || "").trim()) throw new Error("ImageJob 无效：缺少 id。");
    if (!String(job.prompt || "").trim()) throw new Error("ImageJob 无效：缺少 prompt。");
    if (!IMAGE_JOB_STATUSES.includes(job.status)) throw new Error(`ImageJob 状态无效：${job.status}`);
    return true;
}

function setImageJobStatus(job, status, patch = {}) {
    if (!IMAGE_JOB_STATUSES.includes(status)) throw new Error(`ImageJob 状态无效：${status}`);
    job.status = status;
    if (patch.result !== undefined) job.result = patch.result;
    if (patch.error !== undefined) job.error = String(patch.error || "");
    if (patch.errorClass !== undefined) job.errorClass = String(patch.errorClass || "");
    if (patch.errorSummary !== undefined) job.errorSummary = String(patch.errorSummary || "");
    if (patch.rawError !== undefined) job.rawError = String(patch.rawError || "");
    if (patch.retryable !== undefined) job.retryable = !!patch.retryable;
    if (patch.policyRetryCount !== undefined) job.policyRetryCount = Number(patch.policyRetryCount) || 0;
    if (patch.safeRetryPrompt !== undefined) job.safeRetryPrompt = String(patch.safeRetryPrompt || "");
    if (patch.policyOriginalPrompt !== undefined) job.policyOriginalPrompt = String(patch.policyOriginalPrompt || "");
    if (patch.safetyRewritten !== undefined) job.safetyRewritten = !!patch.safetyRewritten;
    if (patch.startedAt !== undefined) job.startedAt = Number(patch.startedAt) || 0;
    if (patch.finishedAt !== undefined) job.finishedAt = Number(patch.finishedAt) || 0;
    if (patch.durationMs !== undefined) job.durationMs = Number(patch.durationMs) || 0;
    return job;
}

function requestCancelImageJob(job) {
    return setImageJobStatus(job, "cancelRequested");
}

// ─── 图生图连续性（预留）────────────────────────────────

function normalizeContinuityMode(value) {
    const key = String(value || "").trim();
    return ["off", "previous", "firstAndPrevious", "characterAndPrevious"].includes(key) ? key : "off";
}

/** 编辑/图生图能力是否可用：当前仅检查预留配置；接口调研接入后在此扩展探测逻辑。 */
function isImageEditAvailable() {
    const s = extension_settings?.[extensionName];
    return !!(s?.imageEditEnabled && String(s?.imageEditEndpoint || "").trim());
}

/**
 * 执行前按 plan.continuity 把参考图写入 job.referenceImages（仅元数据，不影响文生图请求）：
 * - previous / characterAndPrevious：上一张成功图（角色参考图位待人物库挂图后注入）
 * - firstAndPrevious：首图 + 上一张（去重）
 */
function applyContinuityToJob(plan, job) {
    const continuity = plan?.continuity;
    const mode = normalizeContinuityMode(continuity?.mode);
    if (mode === "off") return;

    const refs = [];
    if (mode === "firstAndPrevious" && continuity.firstImage) refs.push(continuity.firstImage);
    if (continuity.previousImage) refs.push(continuity.previousImage);

    const seen = new Set(job.referenceImages);
    for (const url of refs) {
        if (url && !seen.has(url)) {
            seen.add(url);
            job.referenceImages.push(url);
        }
    }
}

/** 成功 job 后更新 plan.continuity 的首图/上一张记录。 */
function updateContinuityAfterJob(plan, job) {
    const continuity = plan?.continuity;
    if (!continuity) return;
    const url = job?.result?.images?.[0];
    if (!url) return;
    if (!continuity.firstImage) continuity.firstImage = url;
    continuity.previousImage = url;
}

/**
 * 7.3 任务级图片请求分发器：内部先分派 text2image，预留 edit/image-to-image 分派点。
 * job.kind === "edit" 且编辑能力不可用（当前恒不可用）→ 失败降级路径：回退文生图，不中断整个 plan。
 */
async function requestImageForJob(job, meta = {}) {
    if (String(job?.kind || "text2image") === "edit") {
        if (isImageEditAvailable()) {
            // 预留分派点：chatgpt2api 编辑接口调研接入后，在此调用 requestViaImageEdits(job, meta)
            console.warn(`[${extensionName}] 编辑接口已配置但尚未实现请求逻辑，job ${job.id} 暂以文生图执行。`);
        } else {
            console.warn(`[${extensionName}] 编辑接口未配置，job ${job.id} 降级为文生图。`);
        }
    }
    return requestImagesFromBackend(job.prompt, { ...meta, prompt: meta.prompt || job.prompt, kind: job.kind });
}

function collectImagePlanResults(plan) {
    const jobs = Array.isArray(plan?.jobs) ? plan.jobs : [];
    const images = [];
    const contentParts = [];
    for (const job of jobs) {
        if (job.status !== "succeeded" || !job.result) continue;
        if (Array.isArray(job.result.images)) images.push(...job.result.images);
        if (job.result.content) contentParts.push(String(job.result.content));
    }
    return {
        images,
        content: contentParts.join("\n").trim(),
        jobs,
        plan,
    };
}

async function executeImageJob(job, requester, meta = {}) {
    validateImageJob(job);
    if (job.status === "cancelRequested") {
        return job.result || { images: [], content: "" };
    }
    const startedAt = Date.now();
    setImageJobStatus(job, "running", {
        error: "",
        errorClass: "",
        errorSummary: "",
        rawError: "",
        retryable: false,
        startedAt,
        finishedAt: 0,
        durationMs: 0,
    });
    try {
        const fullMeta = {
            ...meta,
            prompt: meta.prompt || job.prompt,
            mode: job.mode,
            jobId: job.id,
            index: job.index,
            jobPrompt: job.prompt,
            promptDiagnostics: job.promptDiagnostics,
            promptDraft: summarizePromptDraft(job.promptDraft),
        };
        // requester 为空 → 走任务级分发器（text2image 优先，edit 预留降级）；显式传入则保持旧 (prompt, meta) 契约
        const result = requester
            ? await requester(job.prompt, fullMeta)
            : await requestImageForJob(job, fullMeta);
        const normalized = {
            ...result,
            images: Array.isArray(result?.images) ? result.images : [],
            content: String(result?.content || ""),
        };
        if (job.status === "cancelRequested") {
            return normalized;
        }
        const finishedAt = Date.now();
        setImageJobStatus(job, "succeeded", {
            result: normalized,
            error: "",
            errorClass: "",
            errorSummary: "",
            rawError: "",
            retryable: false,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
        });
        return normalized;
    } catch (error) {
        if (job.status !== "cancelRequested") {
            const finishedAt = Date.now();
            const classified = classifyImageGenerationError(error);
            setImageJobStatus(job, "failed", {
                error: classified.rawMessage || error?.message || String(error || "生成失败"),
                errorClass: classified.errorClass,
                errorSummary: classified.summary,
                rawError: classified.rawMessage,
                finishedAt,
                durationMs: Math.max(0, finishedAt - startedAt),
            });
        }
        throw error;
    }
}

async function executeImagePlan(plan, requester, meta = {}) {
    const jobs = Array.isArray(plan?.jobs) ? plan.jobs : [];
    const policy = normalizePlanFailurePolicy(plan?.failurePolicy || "continue");
    const autoPolicyRetry = meta.policyAutoRetry !== false;
    plan.failurePolicy = policy;
    for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        try {
            applyContinuityToJob(plan, job);
            await executeImageJob(job, requester, meta);
            updateContinuityAfterJob(plan, job);
        } catch (error) {
            markImageJobFailure(job, error, policy);
            if (autoPolicyRetry && canUsePolicySafeRetry(job)) {
                try {
                    await retryImageJob(job, requester, {
                        ...meta,
                        source: meta.source || "policy-safe-retry",
                        policySafeRetry: true,
                    });
                    updateContinuityAfterJob(plan, job);
                    continue;
                } catch (retryError) {
                    markImageJobFailure(job, retryError, policy);
                }
            }
            if (policy === "stop") {
                markPendingJobsStopped(jobs.slice(index + 1), error);
                break;
            }
        }
    }
    return collectImagePlanResults(plan);
}

function markImageJobFailure(job, error, policy = "continue") {
    if (!job) return;
    const classified = classifyImageGenerationError(error || job.rawError || job.error || "生成失败");
    const message = classified.rawMessage || error?.message || String(error || job.error || "生成失败");
    const safeRetryPrompt = classified.errorClass === "policy"
        ? (job.safeRetryPrompt || createPolicySafeRetryPrompt(job.prompt, { visualBibleSummary: formatVisualBibleSummaryForRetry(job) }))
        : "";
    const retryable = normalizePlanFailurePolicy(policy) === "retry"
        || !!job.missingPlaceholder
        || canUsePolicySafeRetry({ ...job, errorClass: classified.errorClass });
    setImageJobStatus(job, "failed", {
        error: message,
        errorClass: classified.errorClass,
        errorSummary: classified.summary,
        rawError: message,
        safeRetryPrompt,
        retryable,
    });
}

function markPendingJobsStopped(jobs, error) {
    const reason = error?.message || String(error || "前序任务失败");
    for (const job of jobs || []) {
        if (!job || job.status !== "pending") continue;
        setImageJobStatus(job, "failed", {
            error: `已停止：${reason}`,
            errorClass: "backend",
            errorSummary: `已停止：${reason}`,
            retryable: false,
            finishedAt: Date.now(),
        });
    }
}

function formatVisualBibleSummaryForRetry(job) {
    const diagnostics = job?.promptDiagnostics || {};
    const parts = [];
    if (Array.isArray(diagnostics.scopedCharacters) && diagnostics.scopedCharacters.length) {
        parts.push(`人物：${diagnostics.scopedCharacters.slice(0, 6).join("、")}`);
    }
    if (Array.isArray(diagnostics.candidateCharacters) && diagnostics.candidateCharacters.length) {
        parts.push(`候选：${diagnostics.candidateCharacters.slice(0, 4).join("、")}`);
    }
    if (diagnostics.activeScene) parts.push(`场景：${diagnostics.activeScene}`);
    if (diagnostics.activeStyle) parts.push(`风格：${diagnostics.activeStyle}`);
    if (diagnostics.imageTextPolicy) parts.push(`对白：${diagnostics.imageTextPolicy}`);
    return parts.join("；");
}

function preparePolicySafeRetry(job) {
    if (!canUsePolicySafeRetry(job)) return false;
    const retryDraft = createPolicyRetryPromptFromDraft(job.promptDraft, {
        legacyPrompt: job.prompt,
    });
    const safePrompt = job.safeRetryPrompt || retryDraft.prompt || createPolicySafeRetryPrompt(job.prompt, {
        visualBibleSummary: formatVisualBibleSummaryForRetry(job),
    });
    job.policyOriginalPrompt = job.policyOriginalPrompt || job.prompt;
    job.safeRetryPrompt = safePrompt;
    job.prompt = safePrompt;
    job.safetyPrompt = safePrompt;
    job.safetyRewritten = true;
    job.promptDiagnostics = {
        ...(job.promptDiagnostics || {}),
        policyRetrySource: retryDraft.diagnostics?.source || "legacy-prompt",
        policyRetrySafety: retryDraft.diagnostics?.safety || "",
    };
    job.policyRetryCount = Number(job.policyRetryCount || 0) + 1;
    return true;
}

function recoverMissingStoryBeatPrompt(job) {
    if (!job?.missingPlaceholder) return String(job?.prompt || "").trim();
    const source = String(job.sourceText || "").trim();
    const index = Number(job.index) + 1;
    return [
        `【补齐节点 ${index}】文本模型未返回该剧情节点，请根据源文本提炼一个安全、清晰、可单独成图的画面。`,
        source ? `【源文本】${source}` : "",
        "画面要求：只生成这一张缺失节点的画面，不重复已成功节点；保持人物、场景和剧情连续性。",
    ].filter(Boolean).join("\n\n");
}

async function retryImageJob(job, requester = requestImagesFromBackend, meta = {}) {
    if (!job) throw new Error("缺少可重试的 ImageJob。");
    if (meta.policySafeRetry) {
        if (!preparePolicySafeRetry(job)) {
            throw new Error("该任务没有可用的安全重试次数。");
        }
    }
    if (job.missingPlaceholder && !String(job.prompt || "").trim()) {
        job.prompt = recoverMissingStoryBeatPrompt(job);
    }
    if (!String(job.prompt || "").trim()) {
        throw new Error("该任务缺少 prompt，无法重试。");
    }
    try {
        setImageJobStatus(job, "pending", { error: "", errorClass: "", errorSummary: "", rawError: "", retryable: false });
        const result = await executeImageJob(job, requester, {
            ...meta,
            source: meta.source || (meta.policySafeRetry ? "policy-safe-retry" : "job-retry"),
            retryOf: job.id,
            prompt: meta.policySafeRetry ? job.prompt : (meta.prompt || job.prompt),
        });
        return result;
    } catch (error) {
        markImageJobFailure(job, error, "retry");
        throw error;
    }
}

function buildPreflightInputForJob(job, fixed, options = {}) {
    const promptParts = job.promptParts || {
        title: job.title || "",
        visualMoment: job.compiledPrompt || job.prompt || job.title || "",
        characters: job.characters || [],
        scene: job.scene || "",
        actions: [],
        anchors: job.anchors || [],
        dialogue: Array.isArray(job.dialogue) ? job.dialogue : [],
        caption: job.caption || "",
        dialogueMode: job.dialogueMode || job.promptDiagnostics?.dialogueMode || "",
    };
    return {
        mode: job.mode,
        sourceText: job.sourceText || job.prompt,
        fixed,
        dialoguePolicy: job.dialogueMode === "bubble" ? "plugin-bubble" : "",
        job: {
            ...job,
            promptParts,
            characters: job.characters || promptParts.characters || [],
            scene: job.scene || promptParts.scene || "",
            anchors: job.anchors || promptParts.anchors || [],
        },
        ...options,
    };
}

function applyPromptDraftToJob(job, draft, patch = {}) {
    job.promptDraft = draft;
    job.compiledPrompt = draft.compiledPrompt || job.compiledPrompt || job.prompt;
    job.prompt = draft.finalPrompt || draft.safetyPrompt || draft.refinedPrompt || draft.compiledPrompt || job.prompt;
    job.refinedPrompt = draft.refinedPrompt || job.refinedPrompt || "";
    job.safetyPrompt = draft.safetyPrompt || job.safetyPrompt || "";
    job.promptDiagnostics = {
        ...(job.promptDiagnostics || {}),
        preflight: true,
        preflightStatus: draft.diagnostics?.preflight || "compiled",
        cleanedSourceChars: String(draft.cleanedText || "").length,
        visibleCharacters: draft.visibleCharacters || [],
        nonVisualCharacters: draft.nonVisualCharacters || [],
        protectedCharacters: (draft.protectedCharacters || []).map((entry) => entry.name),
        protectedScenes: (draft.protectedScenes || []).map((entry) => entry.name),
        missingCharacters: draft.diagnostics?.missingCharacters || [],
        promptTrace: draft.diagnostics?.promptTrace || [],
        promptTraceStages: Array.isArray(draft.diagnostics?.promptTrace) ? draft.diagnostics.promptTrace.map((entry) => entry.stage).filter(Boolean) : [],
        riskChecked: !!draft.riskReport?.checked,
        riskRequiresRewrite: !!draft.riskReport?.requiresRewrite,
        safety: draft.diagnostics?.safety || "",
        validationOk: draft.validation?.ok !== false,
        validationReasons: draft.validation?.reasons || [],
        finalPromptSource: patch.finalPromptSource || "compiled",
        ...patch.diagnostics,
    };
    return job.prompt;
}

async function finalizeCompiledJobPrompt(job, options = {}) {
    const settings = extension_settings[extensionName];
    const fixed = options.fixed || null;
    let draft = createPromptDraftForJob(buildPreflightInputForJob(job, fixed, options));
    let finalPromptSource = "compiled";
    job.compiledPrompt = draft.compiledPrompt || job.compiledPrompt || job.prompt;

    const shouldOptimize = !options.skipOptimize && (options.forceOptimize || settings.optimizeAuto);
    if (settings.optimizeEnabled && shouldOptimize) {
        setStatus("正在精修编译提示词...", "info");
        const refined = await optimizePrompt(draft.compiledPrompt, fixed);
        if (refined) {
            const accepted = acceptRefinementCandidate(refined, draft);
            if (accepted.accepted) {
                draft.refinedPrompt = accepted.prompt;
                draft.finalPrompt = accepted.prompt;
                draft.validation = accepted.validation;
                finalPromptSource = "refined";
            } else {
                draft.refinedPrompt = refined;
                draft.finalPrompt = draft.compiledPrompt;
                draft.validation = validatePromptCandidate(draft.finalPrompt, draft);
                draft.diagnostics.rejectedRefinement = accepted.diagnostics.reason;
                finalPromptSource = "compiled-refinement-rejected";
                console.warn(`[${extensionName}] 精修结果未通过保护字段校验，已回退编译提示词：${accepted.diagnostics.reason}`);
            }
        }
    }

    const riskReport = classifyPromptRisks(draft);
    draft.riskReport = riskReport;
    if (riskReport.requiresRewrite) {
        setStatus("正在定向安全重写提示词...", "info");
        const safeDraft = rewriteRiskyPromptFields(draft, riskReport);
        if (safeDraft.validation?.ok !== false) {
            draft = safeDraft;
            finalPromptSource = "targeted-safety";
        } else {
            console.warn(`[${extensionName}] 定向安全重写未通过校验，保留上一版提示词：${safeDraft.validation?.reasons?.join(",") || "unknown"}`);
            draft.validation = validatePromptCandidate(draft.finalPrompt || draft.compiledPrompt, draft);
        }
    }

    applyPromptDraftToJob(job, draft, {
        finalPromptSource,
        diagnostics: {
            refined: finalPromptSource === "refined",
            safetyLevel: normalizePromptSafetyLevel(settings.promptSafetyLevel),
        },
    });
    console.log(`[${extensionName}] Prompt Preflight：${job.id} / ${job.mode} / ${finalPromptSource} / ${summarizeLogText(job.prompt)}`);
    return job.prompt;
}

async function finalizeImagePlanPrompts(plan, options = {}) {
    const jobs = Array.isArray(plan?.jobs) ? plan.jobs : [];
    for (const job of jobs) {
        if (!job || job.missingPlaceholder || job.status === "failed") continue;
        await finalizeCompiledJobPrompt(job, { ...options, fixed: options.fixed || plan.fixed || null });
    }
    return plan;
}

async function requestSingleImagePlan(sourceText, requestMeta = {}, planOptions = {}) {
    const settings = extension_settings[extensionName];
    const raw = String(planOptions.sourceText || sourceText || "");
    const fixed = planOptions.fixed || await resolveFixedSettings(raw, settings);
    const plan = createSingleImagePlan(raw, { ...planOptions, fixed });
    await finalizeImagePlanPrompts(plan, {
        ...(planOptions.pipelineOptions || {}),
        fixed,
    });
    return executeImagePlan(plan, requestImagesFromBackend, requestMeta);
}

async function runSingleImagePlan(sourceText, pipelineOptions = {}, requestMeta = {}, planOptions = {}) {
    return requestSingleImagePlan(sourceText, requestMeta, {
        ...planOptions,
        prompt: pipelineOptions.promptOverride || planOptions.prompt,
        fixed: pipelineOptions.fixed || planOptions.fixed,
        strategy: pipelineOptions.strategy || planOptions.strategy,
        pipelineOptions,
        sourceText,
    });
}

// ─── 多图模式 ───────────────────────────────────────────

function normalizeBeatCount(value) {
    const count = parseInt(value, 10);
    if (isNaN(count) || count < 2) return 2;
    if (count > 6) return 6;
    return count;
}

/**
 * 多图/漫画 plan 的失败策略归一化：非法存档值回退 continue（保留成功项），
 * 与自动流程的 normalizeAutomaticFlowFailurePolicy（回退 stop）语义不同，勿混用。
 */
function normalizePlanFailurePolicy(value, fallback = "continue") {
    const key = String(value || "").trim();
    return ["stop", "continue", "retry"].includes(key) ? key : fallback;
}

/**
 * LLM 数组条目安全字符串化：LLM 常违反模板返回对象（如 {speaker,text}）或数字，
 * 直接 join 会把 [object Object] 写进生图 prompt。对象按 dialogue 取「说话人：台词」，
 * 其余取 name 或丢弃；标量 String()；空值过滤。
 */
function coerceStringArray(value, { dialogue = false } = {}) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (item == null) return "";
        if (typeof item === "string") return item.trim();
        if (typeof item === "object") {
            if (dialogue && (item.speaker != null || item.text != null)) {
                const speaker = String(item.speaker ?? "").trim();
                const text = String(item.text ?? "").trim();
                return speaker && text ? `${speaker}：${text}` : (text || speaker);
            }
            if (item.name != null) return String(item.name).trim();
            return "";
        }
        return String(item).trim();
    }).filter(Boolean);
}

function renderMultiAnalysisTemplate(template, prompt, beatCount) {
    return String(template || "")
        .replace(/\{\{\s*prompt\s*\}\}/g, String(prompt || "").trim())
        .replace(/\{\{\s*beatCount\s*\}\}/g, String(beatCount || 3));
}

function splitStoryBeats(llmResponse, requestedCount) {
    // 必须用原始对象解析：parseAnalysisJson 只保留 characters/style/scene，会丢掉 beats
    const json = parseRawJsonObject(llmResponse);
    const beats = Array.isArray(json?.beats) ? json.beats : [];
    const count = Number(requestedCount) || 3;

    if (beats.length > count) {
        console.log(`[${extensionName}] 多图拆分返回 ${beats.length} 个节点，截断为请求的 ${count} 个。`);
        return beats.slice(0, count).map((beat, i) => createStoryBeat({ ...beat, index: i }));
    }

    if (beats.length < count) {
        console.log(`[${extensionName}] 多图拆分返回 ${beats.length} 个节点，少于请求的 ${count} 个，保留现有节点。`);
    }

    return beats.map((beat, i) => createStoryBeat({ ...beat, index: i }));
}

async function analyzeStoryBeats(sourceText, beatCount, settings) {
    const template = settings.multiAnalysisTemplate || defaultSettings.multiAnalysisTemplate;
    const systemPrompt = "你是剧情分镜专家。";
    const userMessage = renderMultiAnalysisTemplate(template, sourceText, beatCount);

    let result;
    try {
        setStatus(`正在拆分 ${beatCount} 个剧情节点...`, "info");
        result = await callLlmForText(systemPrompt, userMessage);
    } catch (error) {
        console.error(`[${extensionName}] Story beat analysis failed`, error);
        throw new Error(`剧情节点拆分失败：${error?.message || String(error)}`);
    }

    const beats = splitStoryBeats(result, beatCount);
    if (!beats.length) {
        // 区分于「后端没有返回图片」：是文本模型没按 JSON 输出，让用户排查正确的层
        throw new Error("剧情节点拆分失败：未能从文本模型输出中解析出任何节点，请检查模型是否按 JSON 格式返回 beats 数组。");
    }
    return beats;
}

function createMultiImagePlan(sourceText, options = {}) {
    const raw = String(sourceText || "").trim();
    const beatCount = normalizeBeatCount(options.beatCount || extension_settings?.[extensionName]?.defaultBeatCount || 3);
    const beats = Array.isArray(options.beats) ? options.beats : [];
    const fixed = options.fixed || null;
    const visualBible = options.visualBible || fixed?.visualBible || null;
    const failurePolicy = normalizePlanFailurePolicy(options.failurePolicy || extension_settings?.[extensionName]?.multiImageFailurePolicy);

    const jobs = beats.map((beat, i) => {
        const legacyPrompt = buildBeatPrompt(beat, fixed, options);
        const compiled = compileJobPrompt("multi", {
            mode: "multi",
            title: beat.title || `节点 ${i + 1}`,
            prompt: legacyPrompt,
            characters: beat.characters || [],
            scene: beat.scene || "",
            anchors: beat.anchors || [],
            promptParts: {
                title: beat.title || "",
                visualMoment: beat.visualMoment || beat.title || "",
                characters: beat.characters || [],
                scene: beat.scene || "",
                actions: beat.actions || [],
                anchors: beat.anchors || [],
            },
        }, fixed, { ...options, visualBible });
        return createImageJob({
            mode: "multi",
            kind: "text2image",
            index: i,
            title: beat.title || `节点 ${i + 1}`,
            prompt: compiled.prompt,
            compiledPrompt: compiled.prompt,
            promptDiagnostics: compiled.diagnostics,
            sourceText: raw,
            characters: beat.characters || [],
            scene: beat.scene || "",
            anchors: beat.anchors || [],
            promptParts: {
                title: beat.title || "",
                visualMoment: beat.visualMoment || beat.title || "",
                characters: beat.characters || [],
                scene: beat.scene || "",
                actions: beat.actions || [],
                anchors: beat.anchors || [],
            },
        });
    });
    if (jobs.length < beatCount) {
        jobs.push(...createMissingStoryBeatJobs(raw, jobs.length, beatCount, { failurePolicy }));
    }

    return createImagePlan({
        mode: "multi",
        sourceText: raw,
        fixed,
        visualBible,
        strategy: options.strategy || "auto",
        beats,
        continuity: options.continuity || createContinuityState(extension_settings?.[extensionName]?.continuityMode),
        failurePolicy,
        jobs,
    });
}

function createMissingStoryBeatJobs(sourceText, startIndex, requestedCount, options = {}) {
    const jobs = [];
    const from = Math.max(0, Number(startIndex) || 0);
    const to = normalizeBeatCount(requestedCount);
    for (let index = from; index < to; index += 1) {
        jobs.push(createImageJob({
            mode: "multi",
            kind: "text2image",
            index,
            title: `缺失节点 ${index + 1}`,
            prompt: recoverMissingStoryBeatPrompt({ sourceText, index, missingPlaceholder: true }),
            sourceText,
            status: "failed",
            error: `文本模型未返回第 ${index + 1} 个剧情节点，可单独重试补齐。`,
            retryable: true,
            missingPlaceholder: true,
            requestedCount: to,
            source: "missing-story-beat",
        }));
    }
    return jobs;
}

function buildBeatPrompt(beat, fixed, options = {}) {
    const parts = [];
    const fixedStyle = fixed?.style ?? fixed?.styleText;
    const fixedCharacters = fixed?.characters ?? fixed?.charactersText;
    const fixedScenes = fixed?.scenes ?? fixed?.scenesText;

    // 固定风格
    if (fixedStyle) {
        parts.push(`【风格】${fixedStyle}`);
    }

    // 固定人物外貌
    if (fixedCharacters && String(fixedCharacters).trim()) {
        parts.push(`【人物外貌】${fixedCharacters}`);
    }

    // 固定场景
    if (fixedScenes && String(fixedScenes).trim()) {
        parts.push(`【场景设定】${fixedScenes}`);
    }

    // 本节点视觉瞬间
    parts.push(`【本节点画面】${beat.visualMoment || beat.title || ""}`);

    // 场景环境
    if (beat.scene) {
        parts.push(`场景：${beat.scene}`);
    }

    // 人物与动作
    if (Array.isArray(beat.characters) && beat.characters.length > 0) {
        parts.push(`出场人物：${beat.characters.join("、")}`);
    }

    if (Array.isArray(beat.actions) && beat.actions.length > 0) {
        parts.push(`动作：${beat.actions.join("、")}`);
    }

    // 视觉锚点
    if (Array.isArray(beat.anchors) && beat.anchors.length > 0) {
        parts.push(`视觉锚点：${beat.anchors.join("、")}`);
    }

    return parts.join("\n\n").trim();
}

async function requestMultiImagePlan(sourceText, requestMeta = {}, planOptions = {}) {
    const settings = extension_settings[extensionName];
    const beatCount = normalizeBeatCount(planOptions.beatCount || settings.defaultBeatCount || 3);

    // Step 1: 收集固定设定
    const fixed = planOptions.fixed || await resolveFixedSettings(sourceText, settings);

    // Step 2: LLM 拆分剧情节点
    const beats = await analyzeStoryBeats(sourceText, beatCount, settings);

    // Step 3: 创建多图 plan
    const plan = createMultiImagePlan(sourceText, { ...planOptions, beats, fixed, beatCount });

    // Step 4: 编译后安全重写（多图默认不做通用精修）
    await finalizeImagePlanPrompts(plan, { fixed, skipOptimize: true });

    // Step 5: 执行
    return executeImagePlan(plan, requestImagesFromBackend, requestMeta);
}

async function runMultiImagePlan(sourceText, pipelineOptions = {}, requestMeta = {}, planOptions = {}) {
    // 多图模式不走 processPromptPipeline 优化单个 prompt
    // 而是直接拆分 beats，每个 beat 独立构建 prompt
    return requestMultiImagePlan(sourceText, requestMeta, { ...planOptions, sourceText });
}

// ─── 漫画模式 ───────────────────────────────────────────

function normalizeGenerationMode(value) {
    const key = String(value || "").trim();
    return ["single", "multi", "comic"].includes(key) ? key : "single";
}

function normalizeComicPanelCount(value) {
    const count = parseInt(value, 10);
    if (isNaN(count) || count < 2) return 2;
    if (count > 8) return 8;
    return count;
}

function normalizeComicDialogueMode(value) {
    const key = String(value || "").trim();
    return ["bubble", "modelText"].includes(key) ? key : "bubble";
}

function renderComicAnalysisTemplate(template, prompt, panelCount) {
    return String(template || "")
        .replace(/\{\{\s*prompt\s*\}\}/g, String(prompt || "").trim())
        .replace(/\{\{\s*panelCount\s*\}\}/g, String(panelCount || 4));
}

function splitComicPanels(llmResponse, requestedCount) {
    // 必须用原始对象解析：parseAnalysisJson 只保留 characters/style/scene，会丢掉 panels
    const json = parseRawJsonObject(llmResponse);
    const panels = Array.isArray(json?.panels) ? json.panels : [];
    const count = normalizeComicPanelCount(requestedCount);

    if (panels.length > count) {
        console.log(`[${extensionName}] 漫画分镜返回 ${panels.length} 格，截断为请求的 ${count} 格。`);
        return panels.slice(0, count).map((panel, i) => createComicPanel({ ...panel, index: i + 1 }));
    }

    if (panels.length < count) {
        console.log(`[${extensionName}] 漫画分镜返回 ${panels.length} 格，少于请求的 ${count} 格，保留现有分格。`);
    }

    return panels.map((panel, i) => createComicPanel({ ...panel, index: i + 1 }));
}

async function analyzeComicPanels(sourceText, panelCount, settings) {
    const template = settings.comicAnalysisTemplate || defaultSettings.comicAnalysisTemplate;
    const systemPrompt = "你是漫画分镜师。";
    const dialogueInstruction = settings.comicDialogueEnabled === false
        ? "\n\n【对白开关】本次对白生成已关闭。即使模板示例包含 dialogue/caption 字段，也不要强制创造对白；请让 dialogue 为空数组、caption 为空字符串，除非原文已有必须保留的可见文字。"
        : "\n\n【对白开关】本次对白生成已开启。请为适合的分格填写 dialogue 数组和 caption 字段；没有对白的格子可留空，但不要整篇遗漏可用对白元数据。";
    const userMessage = renderComicAnalysisTemplate(template, sourceText, panelCount) + dialogueInstruction;

    let result;
    try {
        setStatus(`正在规划 ${panelCount} 格漫画分镜...`, "info");
        result = await callLlmForText(systemPrompt, userMessage);
    } catch (error) {
        console.error(`[${extensionName}] Comic panel analysis failed`, error);
        throw new Error(`漫画分镜规划失败：${error?.message || String(error)}`);
    }

    const panels = splitComicPanels(result, panelCount);
    if (!panels.length) {
        // 区分于「后端没有返回图片」：是文本模型没按 JSON 输出，让用户排查正确的层
        throw new Error("漫画分镜规划失败：未能从文本模型输出中解析出任何分格，请检查模型是否按 JSON 格式返回 panels 数组。");
    }
    return panels;
}

/**
 * 为单个 ComicPanel 构建生图 prompt。
 * - bubble（插件气泡，默认）：画面不出现文字/气泡/字幕，对白只保留在元数据里，由插件后续叠加。
 * - modelText（模型画字）：在 prompt 中加入对白气泡的文字布局提示，同时元数据仍完整保存。
 */
function buildPanelPrompt(panel, fixed, options = {}) {
    const dialogueMode = normalizeComicDialogueMode(options.dialogueMode);
    const dialogueEnabled = options.dialogueEnabled !== false;
    const parts = [];
    const fixedStyle = fixed?.style ?? fixed?.styleText;
    const fixedCharacters = fixed?.characters ?? fixed?.charactersText;
    const fixedScenes = fixed?.scenes ?? fixed?.scenesText;

    if (fixedStyle) {
        parts.push(`【风格】漫画分格，${fixedStyle}`);
    } else {
        parts.push("【风格】漫画分格");
    }

    if (fixedCharacters && String(fixedCharacters).trim()) {
        parts.push(`【人物外貌】${fixedCharacters}`);
    }

    if (fixedScenes && String(fixedScenes).trim()) {
        parts.push(`【场景设定】${fixedScenes}`);
    }

    const shot = panel.shotType ? `（${panel.shotType}）` : "";
    parts.push(`【第${panel.index || 1}格画面】${shot}${panel.imageDescription || ""}`);

    if (Array.isArray(panel.characters) && panel.characters.length > 0) {
        parts.push(`出场人物：${panel.characters.join("、")}`);
    }

    if (Array.isArray(panel.actions) && panel.actions.length > 0) {
        parts.push(`动作：${panel.actions.join("、")}`);
    }

    if (Array.isArray(panel.anchors) && panel.anchors.length > 0) {
        parts.push(`视觉锚点：${panel.anchors.join("、")}`);
    }

    if (!dialogueEnabled) {
        parts.push("对白要求：本次不生成对白、旁白或字幕，不要在画面中加入额外文字。");
    } else if (dialogueMode === "modelText") {
        const lines = Array.isArray(panel.dialogue) ? panel.dialogue.filter(Boolean) : [];
        if (lines.length > 0) {
            parts.push(`对白气泡：请在画面中为以下对白绘制清晰可读的中文对白气泡，按说话人位置摆放：${lines.join("；")}`);
        }
        if (panel.caption) {
            parts.push(`旁白框：在画面边缘绘制旁白文字「${panel.caption}」`);
        }
    } else {
        // bubble：明确禁止画面文字，对白由插件以 HTML/CSS 气泡叠加（元数据保存在 ImageJob.dialogue / plan.panels）
        parts.push("画面要求：不要在图片中出现任何文字、对白气泡或字幕，仅靠人物表情与肢体语言传达情绪。");
    }

    return parts.join("\n\n").trim();
}

function createComicImagePlan(sourceText, options = {}) {
    const raw = String(sourceText || "").trim();
    const panels = Array.isArray(options.panels) ? options.panels : [];
    const fixed = options.fixed || null;
    const visualBible = options.visualBible || fixed?.visualBible || null;
    const dialogueMode = normalizeComicDialogueMode(options.dialogueMode);
    const dialogueEnabled = options.dialogueEnabled !== false;

    const jobs = panels.map((panel, i) => {
        const legacyPrompt = buildPanelPrompt(panel, fixed, { ...options, dialogueMode, dialogueEnabled });
        const compiled = compileJobPrompt("comic", {
            mode: "comic",
            title: `第 ${panel.index || i + 1} 格`,
            prompt: legacyPrompt,
            characters: panel.characters || [],
            anchors: panel.anchors || [],
            dialogue: Array.isArray(panel.dialogue) ? [...panel.dialogue] : [],
            promptParts: {
                title: `第 ${panel.index || i + 1} 格`,
                shot: panel.shotType || "",
                visualMoment: panel.imageDescription || "",
                characters: panel.characters || [],
                actions: panel.actions || [],
                anchors: panel.anchors || [],
                dialogue: Array.isArray(panel.dialogue) ? [...panel.dialogue] : [],
                caption: panel.caption || "",
                dialogueMode,
                dialogueEnabled,
            },
        }, fixed, { ...options, visualBible, dialogueMode, dialogueEnabled });
        return createImageJob({
            mode: "comic",
            kind: "text2image",
            index: i,
            title: `第 ${panel.index || i + 1} 格`,
            prompt: compiled.prompt,
            compiledPrompt: compiled.prompt,
            promptDiagnostics: compiled.diagnostics,
            sourceText: raw,
            characters: panel.characters || [],
            anchors: panel.anchors || [],
            dialogue: Array.isArray(panel.dialogue) ? [...panel.dialogue] : [],
            dialogueMode,
            dialogueEnabled,
            caption: panel.caption || "",
            promptParts: {
                title: `第 ${panel.index || i + 1} 格`,
                shot: panel.shotType || "",
                visualMoment: panel.imageDescription || "",
                characters: panel.characters || [],
                actions: panel.actions || [],
                anchors: panel.anchors || [],
                dialogue: Array.isArray(panel.dialogue) ? [...panel.dialogue] : [],
                caption: panel.caption || "",
                dialogueMode,
                dialogueEnabled,
            },
        });
    });

    return createImagePlan({
        mode: "comic",
        sourceText: raw,
        fixed,
        visualBible,
        strategy: dialogueMode,
        panels,
        continuity: options.continuity || createContinuityState(extension_settings?.[extensionName]?.continuityMode),
        failurePolicy: normalizePlanFailurePolicy(options.failurePolicy || extension_settings?.[extensionName]?.comicFailurePolicy),
        jobs,
    });
}

async function requestComicImagePlan(sourceText, requestMeta = {}, planOptions = {}) {
    const settings = extension_settings[extensionName];
    const panelCount = normalizeComicPanelCount(planOptions.panelCount || settings.comicPanelCount || 4);
    const dialogueMode = normalizeComicDialogueMode(planOptions.dialogueMode || settings.comicDialogueMode);
    const dialogueEnabled = planOptions.dialogueEnabled ?? (settings.comicDialogueEnabled !== false);

    // Step 1: 收集固定设定
    const fixed = planOptions.fixed || await resolveFixedSettings(sourceText, settings);

    // Step 2: LLM 规划分镜
    const panels = await analyzeComicPanels(sourceText, panelCount, { ...settings, comicDialogueEnabled: dialogueEnabled });

    // Step 3: 创建漫画 plan（每格一个 ImageJob，对白元数据随 job 保存）
    const plan = createComicImagePlan(sourceText, { ...planOptions, panels, fixed, panelCount, dialogueMode, dialogueEnabled });

    // Step 4: 编译后安全重写（漫画默认不做通用精修）
    await finalizeImagePlanPrompts(plan, { fixed, skipOptimize: true });

    // Step 5: 逐格串行执行（保留后续整页四格/双格一组的扩展点：分组逻辑可在此分批）
    return executeImagePlan(plan, requestImagesFromBackend, requestMeta);
}

async function runComicImagePlan(sourceText, pipelineOptions = {}, requestMeta = {}, planOptions = {}) {
    // 漫画模式同多图：不走单 prompt 优化，直接分镜后逐格构建 prompt
    return requestComicImagePlan(sourceText, requestMeta, { ...planOptions, sourceText });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: IMAGE REQUEST — DISPATCHER
// ═══════════════════════════════════════════════════════════════

/**
 * 图片请求分发器 — 根据 apiMode 选择不同后端
 */
async function requestImagesFromBackend(prompt, meta = {}) {
    const settings = extension_settings[extensionName];
    const result = settings.apiMode === "images"
        ? await requestViaImagesGenerations(prompt)
        : await requestViaChatCompletions(prompt);

    // 唯一 choke point：所有入口生成的图都在此落盘 + 记录图库。
    // 换成磁盘路径后，附加进 extra.media 的就是短路径，聊天文件不再内联大 base64。
    if (Array.isArray(result.images) && result.images.length) {
        result.images = await persistAndRecordImages(
            result.images,
            meta.prompt || prompt,
            meta.source || "generate",
            {
                jobId: meta.jobId,
                mode: meta.mode,
                promptDiagnostics: meta.promptDiagnostics,
                promptDraft: meta.promptDraft,
            },
        );
    }
    return result;
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
// SECTION 10.5: AUTOMATIC WHOLE-MESSAGE FLOW（自动整条 AI 消息生图）
// ═══════════════════════════════════════════════════════════════

const automaticMessageQueues = new Map();
const automaticMessageTaskIndex = new Map();
const automaticMessageInFlight = new Set();
let automaticTaskSeq = 0;

function normalizeAutomaticFlowFailurePolicy(value) {
    const key = String(value || "stop").trim();
    return ["stop", "continue", "retry"].includes(key) ? key : "stop";
}

function normalizeAutomaticFlowSettings(input = {}) {
    const minChars = Number(input.automaticFlowMinChars);
    return {
        automaticFlowEnabled: !!input.automaticFlowEnabled,
        automaticFlowFollowWorkbench: input.automaticFlowFollowWorkbench !== false,
        automaticFlowMinChars: Number.isFinite(minChars) ? Math.max(0, Math.floor(minChars)) : defaultSettings.automaticFlowMinChars,
        automaticFlowFailurePolicy: normalizeAutomaticFlowFailurePolicy(input.automaticFlowFailurePolicy),
        automaticFlowShowQueue: input.automaticFlowShowQueue !== false,
        automaticFlowCancelEnabled: input.automaticFlowCancelEnabled !== false,
    };
}

function getAutomaticMessageSkipReason(settings, message, cleanedText = null) {
    if (!settings?.automaticFlowEnabled) return "disabled";
    if (!message || message.is_user || message.is_system || !message.mes) return "user_or_system";
    const text = cleanedText == null ? cleanRpText(message.mes).trim() : String(cleanedText || "").trim();
    const minChars = normalizeAutomaticFlowSettings(settings).automaticFlowMinChars;
    if (text.length < minChars) return "too_short";
    return "";
}

function normalizeAutomaticChatId(value) {
    const raw = value && typeof value === "object" ? value.chatId : value;
    return String(raw || "chat");
}

function messageHasImageAttachment(message) {
    const extra = message?.extra || {};
    if (Array.isArray(extra.media) && extra.media.some((item) => item?.url && String(item.type || "image").toLowerCase() === "image")) {
        return true;
    }
    if (Array.isArray(extra.image_swipes) && extra.image_swipes.some(Boolean)) return true;
    return typeof extra.image === "string" && extra.image.trim().length > 0;
}

function wasAutomaticMessageAlreadyAttached(message) {
    const meta = message?.extra?.[extensionName];
    return meta?.source === "automatic-message" && messageHasImageAttachment(message);
}

function isSameAutomaticMessage(currentMessage, originalMessage, cleanedText = "") {
    if (!currentMessage || currentMessage.is_user || currentMessage.is_system) return false;
    if (currentMessage === originalMessage) return true;

    const originalText = String(cleanedText || cleanRpText(originalMessage?.mes || "").trim()).trim();
    const currentText = cleanRpText(currentMessage.mes || "").trim();
    if (originalText && currentText === originalText) return true;

    const currentSendDate = currentMessage.send_date ?? currentMessage.sendDate ?? currentMessage.extra?.send_date;
    const originalSendDate = originalMessage?.send_date ?? originalMessage?.sendDate ?? originalMessage?.extra?.send_date;
    return currentSendDate != null && originalSendDate != null && String(currentSendDate) === String(originalSendDate);
}

function findAutomaticAttachmentMessage(context, task, originalMessage) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    const cleanedText = String(task?.cleanedText || "").trim();
    const seen = new Set();
    const tryIndex = (index) => {
        if (!Number.isInteger(index) || index < 0 || index >= chat.length || seen.has(index)) return null;
        seen.add(index);
        const message = chat[index];
        return isSameAutomaticMessage(message, originalMessage, cleanedText)
            ? { messageId: index, message }
            : null;
    };

    const preferredIndex = Number(task?.messageId);
    const preferred = tryIndex(Number.isInteger(preferredIndex) ? preferredIndex : -1);
    if (preferred) return preferred;

    const identityIndex = originalMessage ? chat.indexOf(originalMessage) : -1;
    const byIdentity = tryIndex(identityIndex);
    if (byIdentity) return byIdentity;

    const originalSendDate = originalMessage?.send_date ?? originalMessage?.sendDate ?? originalMessage?.extra?.send_date;
    if (originalSendDate != null) {
        for (let i = 0; i < chat.length; i += 1) {
            const message = chat[i];
            const sendDate = message?.send_date ?? message?.sendDate ?? message?.extra?.send_date;
            if (sendDate != null && String(sendDate) === String(originalSendDate)) {
                const found = tryIndex(i);
                if (found) return found;
            }
        }
    }

    if (cleanedText) {
        for (let i = 0; i < chat.length; i += 1) {
            const message = chat[i];
            if (!message || message.is_user || message.is_system) continue;
            if (cleanRpText(message.mes || "").trim() === cleanedText) {
                const found = tryIndex(i);
                if (found) return found;
            }
        }
    }

    return null;
}

function resolveAutomaticAttachmentTarget(task, originalMessage) {
    const currentContext = getContext();
    if (normalizeAutomaticChatId(currentContext) !== normalizeAutomaticChatId(task?.chatId)) {
        return { context: currentContext, messageId: task?.messageId, message: null, reason: "chat_changed" };
    }

    const target = findAutomaticAttachmentMessage(currentContext, task, originalMessage);
    if (!target?.message) {
        return { context: currentContext, messageId: task?.messageId, message: null, reason: "message_changed" };
    }

    return { context: currentContext, messageId: target.messageId, message: target.message, reason: "" };
}

function getAutomaticQueueState(chatId) {
    const key = String(chatId || "chat");
    let state = automaticMessageQueues.get(key);
    if (!state) {
        state = { tail: Promise.resolve(), tasks: [] };
        automaticMessageQueues.set(key, state);
    }
    return state;
}

function createAutomaticMessageTask(chatId, messageId, message, cleanedText, settings = {}) {
    const followWorkbench = settings.automaticFlowFollowWorkbench !== false;
    const mode = followWorkbench
        ? normalizeGenerationMode(settings.generationMode || (settings.multiImageEnabled ? "multi" : "single"))
        : "single";
    const task = {
        id: `auto_${++automaticTaskSeq}`,
        chatId: String(chatId || "chat"),
        messageId,
        message,
        cleanedText: String(cleanedText || "").trim(),
        status: "queued",
        failurePolicy: normalizeAutomaticFlowFailurePolicy(settings.automaticFlowFailurePolicy),
        followWorkbench,
        mode,
        beatCount: normalizeBeatCount(settings.defaultBeatCount),
        panelCount: normalizeComicPanelCount(settings.comicPanelCount),
        dialogueEnabled: settings.comicDialogueEnabled !== false,
        dialogueMode: normalizeComicDialogueMode(settings.comicDialogueMode),
        multiFailurePolicy: normalizePlanFailurePolicy(settings.multiImageFailurePolicy),
        comicFailurePolicy: normalizePlanFailurePolicy(settings.comicFailurePolicy),
        inFlightKey: `${String(chatId || "chat")}:${messageId}`,
        createdAt: Date.now(),
        startedAt: 0,
        finishedAt: 0,
        result: null,
        error: "",
    };
    automaticMessageTaskIndex.set(task.id, task);
    return task;
}

function updateAutomaticQueueStatus(chatId = null) {
    const entries = chatId == null
        ? Array.from(automaticMessageQueues.values()).flatMap((state) => state.tasks)
        : getAutomaticQueueState(chatId).tasks;
    const active = entries.filter((task) => !["succeeded", "failed", "cancelRequested", "skipped"].includes(task.status));
    const text = active.length
        ? `自动队列：${active.filter((task) => task.status === "running").length} 运行 / ${active.filter((task) => task.status === "queued").length} 排队`
        : "自动队列：空闲";
    try {
        const visible = extension_settings?.[extensionName]?.automaticFlowShowQueue !== false;
        $("#oair_automatic_flow_queue_status").toggle(visible).text(text);
    } catch (_) {}
    return text;
}

function recordAutomaticFlowEvent(kind, text, task = null) {
    const eventKind = String(kind || "info").trim() || "info";
    const message = String(text || "").trim();
    if (!message) return;
    const taskSuffix = task?.id ? ` [${task.id}]` : "";
    console.log(`[${extensionName}] [自动流程:${eventKind}]${taskSuffix} ${message}`);
    try {
        const box = $("#oair_automatic_flow_events");
        if (!box.length) return;
        const item = $("<div>")
            .addClass(`oair-auto-flow-event oair-auto-flow-${eventKind.replace(/[^a-z0-9_-]/gi, "-")}`)
            .attr("data-oair-auto-flow-kind", eventKind);
        $("<span>").addClass("oair-auto-flow-kind").text(eventKind).appendTo(item);
        $("<span>").addClass("oair-auto-flow-text").text(message).appendTo(item);
        box.prepend(item);
        box.children().slice(20).remove();
    } catch (_) {}
}

function getAutomaticQueueSnapshot(chatId = null) {
    const states = chatId == null ? Array.from(automaticMessageQueues.values()) : [getAutomaticQueueState(chatId)];
    return states.flatMap((state) => state.tasks.map((task) => ({
        id: task.id,
        chatId: task.chatId,
        messageId: task.messageId,
        status: task.status,
        error: task.error,
    })));
}

function releaseAutomaticTask(task) {
    if (!task) return;
    automaticMessageTaskIndex.delete(task.id);
    if (task.inFlightKey) automaticMessageInFlight.delete(task.inFlightKey);
}

function cancelAutomaticMessageTask(taskId = "") {
    const task = automaticMessageTaskIndex.get(String(taskId || ""));
    if (!task) return false;
    if (["queued", "running"].includes(task.status)) {
        task.status = "cancelRequested";
        releaseAutomaticTask(task);
        updateAutomaticQueueStatus(task.chatId);
        setStatus(`已请求取消自动任务 ${task.messageId}`, "warning");
        return true;
    }
    return false;
}

function cancelAutomaticMessageTasks(chatId = null) {
    let count = 0;
    const states = chatId == null ? Array.from(automaticMessageQueues.values()) : [getAutomaticQueueState(chatId)];
    for (const state of states) {
        for (const task of state.tasks) {
            if (["queued", "running"].includes(task.status)) {
                task.status = "cancelRequested";
                releaseAutomaticTask(task);
                count += 1;
            }
        }
    }
    updateAutomaticQueueStatus(chatId);
    if (count) setStatus(`已请求取消 ${count} 个自动任务`, "warning");
    return count;
}

function pruneAutomaticQueue(chatId) {
    const state = getAutomaticQueueState(chatId);
    const done = state.tasks.filter((task) => ["succeeded", "failed", "cancelRequested", "skipped"].includes(task.status));
    for (const task of done) releaseAutomaticTask(task);
    state.tasks = state.tasks.filter((task) => !["succeeded", "failed", "cancelRequested", "skipped"].includes(task.status)).slice(-20);
    updateAutomaticQueueStatus(chatId);
}

async function processAutomaticMessageTask(task, runner) {
    if (task.status === "cancelRequested") {
        task.finishedAt = Date.now();
        return task.result || { images: [], content: "" };
    }
    task.status = "running";
    task.startedAt = Date.now();
    updateAutomaticQueueStatus(task.chatId);
    try {
        const result = await runner(task);
        const normalized = {
            ...result,
            images: Array.isArray(result?.images) ? result.images : [],
            content: String(result?.content || ""),
        };
        if (task.status === "cancelRequested") {
            task.finishedAt = Date.now();
            return normalized;
        }
        task.status = "succeeded";
        task.result = normalized;
        task.error = "";
        task.finishedAt = Date.now();
        return normalized;
    } catch (error) {
        if (task.status !== "cancelRequested") {
            task.status = "failed";
            task.error = error?.message || String(error || "自动生图失败");
        }
        task.finishedAt = Date.now();
        throw error;
    } finally {
        updateAutomaticQueueStatus(task.chatId);
    }
}

function enqueueAutomaticMessageTask(task, runner) {
    const state = getAutomaticQueueState(task.chatId);
    state.tasks.push(task);
    updateAutomaticQueueStatus(task.chatId);
    const run = state.tail.catch(() => null).then(async () => {
        if (task.status === "cancelRequested") {
            task.finishedAt = Date.now();
            updateAutomaticQueueStatus(task.chatId);
            return task.result || { images: [], content: "" };
        }
        return processAutomaticMessageTask(task, runner);
    }).finally(() => pruneAutomaticQueue(task.chatId));
    state.tail = run.catch(() => null);
    return run;
}

async function runAutomaticImagePlanForTask(task) {
    const cleanedText = String(task?.cleanedText || "").trim();
    const requestMeta = { source: "automatic-message", prompt: cleanedText };
    const mode = normalizeGenerationMode(task?.mode);
    logCharacterSelectionSummary(cleanedText, extension_settings[extensionName], "自动整条消息");

    if (mode === "comic") {
        return runComicImagePlan(cleanedText, { forceOptimize: false }, requestMeta, {
            panelCount: normalizeComicPanelCount(task.panelCount),
            dialogueEnabled: task.dialogueEnabled !== false,
            dialogueMode: normalizeComicDialogueMode(task.dialogueMode),
            failurePolicy: normalizePlanFailurePolicy(task.comicFailurePolicy),
        });
    }

    if (mode === "multi") {
        return runMultiImagePlan(cleanedText, { forceOptimize: false }, requestMeta, {
            beatCount: normalizeBeatCount(task.beatCount),
            failurePolicy: normalizePlanFailurePolicy(task.multiFailurePolicy),
        });
    }

    return runSingleImagePlan(cleanedText, { forceOptimize: false }, requestMeta, {
        failurePolicy: normalizeAutomaticFlowFailurePolicy(task.failurePolicy),
    });
}

async function handleAutomaticWholeMessage(messageId, context, settings) {
    const message = context?.chat?.[messageId];
    const cleanedText = cleanRpText(message?.mes || "").trim();
    const skipReason = getAutomaticMessageSkipReason(settings, message, cleanedText);
    if (skipReason) {
        recordAutomaticFlowEvent("skip", `自动流程跳过：${skipReason} / 消息 ${messageId}`);
        if (skipReason === "too_short") {
            setStatus(`自动流程跳过：正文少于 ${normalizeAutomaticFlowSettings(settings).automaticFlowMinChars} 字`, "info");
        }
        return false;
    }
    if (wasAutomaticMessageAlreadyAttached(message)) {
        recordAutomaticFlowEvent("skip", `自动流程跳过：消息 ${messageId} 已有自动生成图片`);
        setStatus(`自动流程跳过：消息 ${messageId} 已自动生图`, "info");
        return false;
    }

    const chatId = normalizeAutomaticChatId(context);
    const inFlightKey = `${chatId}:${messageId}`;
    if (automaticMessageInFlight.has(inFlightKey)) {
        recordAutomaticFlowEvent("skip", `自动流程跳过：消息 ${messageId} 已在队列中`);
        setStatus(`自动流程跳过：消息 ${messageId} 已在队列中`, "info");
        return false;
    }

    const task = createAutomaticMessageTask(chatId, messageId, message, cleanedText, settings);
    automaticMessageInFlight.add(inFlightKey);
    recordAutomaticFlowEvent("queued", `自动流程已排队：消息 ${messageId}`, task);
    setStatus(`自动流程已排队：消息 ${messageId}`, "info");

    try {
        await enqueueAutomaticMessageTask(task, async (currentTask) => {
            recordAutomaticFlowEvent("start", `自动流程开始：消息 ${messageId}`, currentTask);
            recordAutomaticFlowEvent("running", "本地编译提示词并请求图片后端", currentTask);
            setStatus(`自动流程生图中：消息 ${messageId}`, "info");
            const result = await runAutomaticImagePlanForTask(currentTask);
            if ((result.jobs || []).some((job) => job?.safeRetryPrompt)) {
                recordAutomaticFlowEvent("safety-rewrite", `自动流程触发安全重写：消息 ${messageId}`, currentTask);
            }
            if ((result.jobs || []).some((job) => Number(job?.policyRetryCount || 0) > 0 || job?.errorClass === "policy")) {
                recordAutomaticFlowEvent("policy-retry", `自动流程记录策略重试/政策状态：消息 ${messageId}`, currentTask);
            }
            addGenerationHistoryRecord(createGenerationHistoryRecord({
                source: "automatic-message",
                mode: currentTask.mode,
                prompt: cleanedText,
                plan: result.plan,
                jobs: result.jobs,
                status: result.images.length ? "succeeded" : "failed",
            }));
            if (currentTask.status === "cancelRequested") return result;
            const target = resolveAutomaticAttachmentTarget(currentTask, message);
            if (!target.message) {
                const reasonText = target.reason === "chat_changed" ? "已不在当前聊天" : "已被修改或移除";
                recordAutomaticFlowEvent("skip", `自动流程跳过附加：消息 ${messageId} ${reasonText}`, currentTask);
                setStatus(`自动流程跳过附加：消息 ${messageId} ${reasonText}`, "warning");
                return result;
            }
            if (result.images.length > 0) {
                const targetMessage = target.message;
                const finalPrompt = result.jobs?.[0]?.prompt || cleanedText;
                const dialogueMeta = createDialogueAttachmentMetadata(result.jobs);
                attachGeneratedImages(targetMessage, result.images, [finalPrompt], dialogueMeta);
                targetMessage.extra = targetMessage.extra || {};
                targetMessage.extra[extensionName] = {
                    ...(targetMessage.extra[extensionName] || {}),
                    lastRunAt: Date.now(),
                    source: "automatic-message",
                    taskId: currentTask.id,
                    mode: currentTask.mode,
                    images: dedupeStrings(result.images).length,
                };
                await updateMessageBlockWhenReady(target.messageId, targetMessage, { rerenderMessage: false });
                try { await target.context?.saveChat?.(); } catch (e) { console.warn(`[${extensionName}] saveChat failed`, e); }
                recordAutomaticFlowEvent("success", `自动流程完成：消息 ${messageId}，图片 ${dedupeStrings(result.images).length} 张`, currentTask);
                setStatus(`自动流程完成：消息 ${messageId}`, "success");
                toastr.success("自动消息生图完成。");
            } else {
                recordAutomaticFlowEvent("failure", `自动流程失败：消息 ${messageId} 未检测到图片输出`, currentTask);
                setStatus("自动流程未检测到图片输出", "warning");
                toastr.warning("后端没有返回图片结果。");
            }
            return result;
        });
    } catch (error) {
        console.error(`[${extensionName}] Automatic whole-message generation failed`, error);
        recordAutomaticFlowEvent("failure", `自动流程失败：消息 ${messageId} / ${error?.message || String(error || "")}`, task);
        setStatus(error?.message || String(error || "自动生图失败"), "error");
        toastr.error(error?.message || String(error || "自动生图失败"));
    } finally {
        automaticMessageInFlight.delete(inFlightKey);
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 11: MESSAGE PROCESSING (auto pipeline)
// ═══════════════════════════════════════════════════════════════

function maybeAutoExtractVisualLibraries(sourceText, options = {}) {
    const settings = extension_settings[extensionName] || defaultSettings;
    const normalized = normalizeVisualExtractionSettings(settings);
    if (!normalized.autoExtractCharactersEnabled && !normalized.autoExtractScenesEnabled) {
        return null;
    }
    const result = applyAutomaticVisualExtraction({
        context: getCurrentChatVisualContext(),
        store: getChatVisualStore(),
        settings: normalized,
        sourceText,
    });
    const characterCount = result?.character?.added?.length || 0;
    const sceneCount = result?.scene?.added?.length || 0;
    const skippedCount = (result?.character?.skipped?.length || 0) + (result?.scene?.skipped?.length || 0);
    if (characterCount || sceneCount) {
        updateLibraryHiddenFields("character");
        updateLibraryHiddenFields("scene");
        renderAllLibrarySummaries();
        updateVisualScopeStatus();
        const text = `设定库自动提取：人物 +${characterCount}，场景 +${sceneCount}${skippedCount ? `，跳过重复 ${skippedCount}` : ""}`;
        recordAutomaticFlowEvent("extract", text, options.task || null);
        setStatus(text, "success");
    } else if (skippedCount) {
        recordAutomaticFlowEvent("extract", `设定库自动提取：跳过重复 ${skippedCount} 条`, options.task || null);
    }
    return result;
}

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

    maybeAutoExtractVisualLibraries(cleanRpText(message.mes || ""), { source: "message", messageId });

    if (!settings.automaticFlowEnabled) {
        return;
    }

    handleAutomaticWholeMessage(messageId, context, settings);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12: MANUAL GENERATION
// ═══════════════════════════════════════════════════════════════

const manualWorkbenchState = {
    characterCandidates: [],
    confirmedCharacters: [],
    lastJobs: [],
};

function logCharacterSelectionSummary(sourceText, settings, label = "自动路径", confirmed = null) {
    const refs = Array.isArray(confirmed) ? confirmed : collectCharacterCandidatesForWorkbench(sourceText, getEffectiveVisualSettings(settings));
    const names = refs.map((item) => item.name).filter(Boolean);
    console.log(`[${extensionName}] 人物选择摘要(${label})：${names.length ? names.join("、") : "无显式人物引用"}。`);
}

function refreshWorkbenchCharacterCandidates() {
    const fp = $("#oair_floating_panel");
    const sourceText = String(fp.find("#oair_manual_prompt").val() || "").trim();
    const visualBible = resolveCurrentChatVisualBible(sourceText, extension_settings[extensionName]);
    const settings = getEffectiveVisualSettings(extension_settings[extensionName]);
    const personaCandidates = visualBible.characterCandidates?.length
        ? visualBible.characterCandidates
        : resolvePersonaVisualCandidates({
            context: getCurrentChatVisualContext(),
            sourceText,
            visualBible,
        });
    manualWorkbenchState.characterCandidates = collectCharacterCandidatesForWorkbench(sourceText, settings, {
        storyCandidates: personaCandidates,
    });
    renderCharacterConfirmationUi();
}

function formatCharacterCandidateSource(candidate = {}) {
    const source = String(candidate.source || "");
    if (source === "library") return "当前角色卡库";
    if (source === "story-derived" || source === "story") return "剧情候选";
    if (source === "worldbook") return "世界书";
    if (source === "legacy") return "旧库导入";
    if (source === "missing") return "缺外貌";
    return source || "候选";
}

function persistWorkbenchConfirmedCharacters({ saveProfile = false } = {}) {
    const confirmed = normalizeConfirmedCharacterReferences(manualWorkbenchState.characterCandidates);
    manualWorkbenchState.confirmedCharacters = confirmed;
    saveCurrentChatVisualScopePatch({ confirmedCharacters: confirmed });
    if (saveProfile && confirmed.length) {
        confirmCharacterCandidatesIntoScope({
            context: getCurrentChatVisualContext(),
            store: getChatVisualStore(),
            candidates: confirmed.map((item) => ({ ...item, selected: true })),
        });
        renderAllLibrarySummaries();
    }
    return confirmed;
}

function renderCharacterConfirmationUi() {
    const fp = $("#oair_floating_panel");
    const box = fp.find("#oair_character_confirmation");
    if (!box.length) return;
    box.empty();

    const candidates = manualWorkbenchState.characterCandidates || [];
    if (!candidates.length) {
        box.append('<div class="oair-plan-placeholder">未匹配到人物库候选；生成时仍会使用当前固定设定和世界书注入。</div>');
        manualWorkbenchState.confirmedCharacters = [];
        saveCurrentChatVisualScopePatch({ confirmedCharacters: [] });
        return;
    }

    for (const [index, candidate] of candidates.entries()) {
        const card = $('<div class="oair-character-card"></div>');
        const header = $('<div class="oair-character-card-head"></div>');
        $('<input type="checkbox" class="oair-character-candidate-check">')
            .prop("checked", candidate.selected !== false)
            .attr("data-index", index)
            .appendTo(header);
        $("<span>").text(candidate.name).appendTo(header);
        $("<span>")
            .addClass(candidate.stable ? "oair-badge oair-badge-green" : "oair-badge oair-badge-orange")
            .text(candidate.stable ? (candidate.source === "legacy" ? "旧库" : "当前库") : "候选")
            .appendTo(header);
        $("<span>").addClass("oair-character-source").text(formatCharacterCandidateSource(candidate)).appendTo(header);
        $('<button type="button" class="menu_button oair-character-toggle-btn"></button>')
            .attr("data-index", index)
            .text(candidate.selected === false ? "选用" : "跳过")
            .appendTo(header);
        header.appendTo(card);
        $('<textarea class="text_pole oair-character-candidate-text" rows="2"></textarea>')
            .attr("data-index", index)
            .val(candidate.text)
            .appendTo(card);
        card.appendTo(box);
    }

        box.find(".oair-character-candidate-check")
            .off("click.oair_confirm change.oair_confirm")
            .on("click.oair_confirm", (e) => e.stopPropagation())
            .on("change.oair_confirm", function () {
        const index = Number($(this).attr("data-index"));
        if (manualWorkbenchState.characterCandidates[index]) {
            manualWorkbenchState.characterCandidates[index].selected = $(this).prop("checked");
        }
        persistWorkbenchConfirmedCharacters({ saveProfile: true });
    });
    box.find(".oair-character-candidate-text").off("input.oair_confirm").on("input.oair_confirm", function () {
        const index = Number($(this).attr("data-index"));
        if (manualWorkbenchState.characterCandidates[index]) {
            manualWorkbenchState.characterCandidates[index].text = String($(this).val() || "");
        }
        persistWorkbenchConfirmedCharacters({ saveProfile: true });
    });
    box.find(".oair-character-toggle-btn").off("click.oair_confirm").on("click.oair_confirm", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const index = Number($(this).attr("data-index"));
        const candidate = manualWorkbenchState.characterCandidates[index];
        if (!candidate) return;
        candidate.selected = candidate.selected === false;
        box.find(`.oair-character-candidate-check[data-index="${index}"]`).prop("checked", candidate.selected !== false);
        $(this).text(candidate.selected === false ? "选用" : "跳过");
        persistWorkbenchConfirmedCharacters({ saveProfile: true });
    });
    persistWorkbenchConfirmedCharacters({ saveProfile: false });
}

function getWorkbenchConfirmedCharacters() {
    return persistWorkbenchConfirmedCharacters({ saveProfile: true });
}

async function buildManualPlanOptions(sourceText, baseOptions = {}) {
    const settings = extension_settings[extensionName];
    const confirmed = getWorkbenchConfirmedCharacters();
    if (!confirmed.length) {
        logCharacterSelectionSummary(sourceText, settings, "手动路径");
        return baseOptions;
    }
    const fixed = await resolveFixedSettings(sourceText, settings);
    logCharacterSelectionSummary(sourceText, settings, "手动确认", confirmed);
    return applyConfirmedCharacterReferences({ ...baseOptions, fixed }, confirmed);
}

function formatPromptDiagnosticsForUi(diagnostics = {}) {
    if (!diagnostics || typeof diagnostics !== "object") return "";
    const parts = [];
    if (diagnostics.preflight) {
        parts.push(`预检：${diagnostics.finalPromptSource || diagnostics.preflightStatus || "compiled"}`);
    }
    if (diagnostics.storageSource || diagnostics.scopeKey) {
        parts.push(`设定：${diagnostics.storageSource || "scope"}`);
    }
    if (diagnostics.activeStyle) parts.push(`风格：${diagnostics.activeStyle}`);
    if (diagnostics.activeScene) parts.push(`场景：${diagnostics.activeScene}`);
    if (Array.isArray(diagnostics.scopedCharacters) && diagnostics.scopedCharacters.length) {
        parts.push(`人物：${diagnostics.scopedCharacters.slice(0, 4).join("、")}`);
    }
    if (Array.isArray(diagnostics.missingCharacters) && diagnostics.missingCharacters.length) {
        parts.push(`缺外貌：${diagnostics.missingCharacters.slice(0, 4).join("、")}`);
    }
    if (diagnostics.riskChecked) {
        parts.push(diagnostics.riskRequiresRewrite ? "安全：已定向重写" : "安全：已分类");
    }
    if (Array.isArray(diagnostics.promptTraceStages) && diagnostics.promptTraceStages.length) {
        parts.push(`Trace：${diagnostics.promptTraceStages.slice(0, 4).join("→")}`);
    }
    if (diagnostics.imageTextPolicy) parts.push(`对白：${diagnostics.imageTextPolicy}`);
    return parts.join(" · ");
}

function getImageJobFailureSummary(job) {
    return String(job?.errorSummary || job?.error || "生成失败").replace(/\s+/g, " ").trim();
}

function renderPlanProgress(jobs = []) {
    const fp = $("#oair_floating_panel");
    const box = fp.find("#oair_plan_progress");
    if (!box.length) return;
    box.empty();
    const list = Array.isArray(jobs) ? jobs : [];
    if (!list.length) {
        box.append('<div class="oair-plan-placeholder">暂无任务进度。</div>');
        return;
    }
    for (const job of list) {
        const card = $('<div class="oair-progress-card"></div>');
        $("<div>")
            .addClass("oair-progress-title")
            .text(`${Number(job.index) + 1}. ${job.title || "图片任务"}`)
            .appendTo(card);
        $("<div>")
            .addClass(`oair-progress-status oair-status-${job.status}`)
            .text(job.status === "succeeded" ? "成功" : job.status === "failed" ? `失败：${getImageJobFailureSummary(job)}` : job.status === "running" ? "运行中" : "等待中")
            .appendTo(card);
        if (job.status === "failed" && job.error && job.error !== job.errorSummary) {
            $("<div>")
                .addClass("oair-error-summary")
                .text(job.error)
                .appendTo(card);
        }
        const diagnosticsText = formatPromptDiagnosticsForUi(job.promptDiagnostics);
        if (diagnosticsText) {
            $("<div>")
                .addClass("oair-progress-status")
                .text(diagnosticsText)
                .appendTo(card);
        }
        if (job.retryable) {
            const policySafeRetry = canUsePolicySafeRetry(job);
            $('<button type="button" class="menu_button oair-retry-job-btn"></button>')
                .text(policySafeRetry ? "安全重试" : "重试本项")
                .on("click", async function () {
                    $(this).prop("disabled", true).text("重试中...");
                    try {
                        await retryImageJob(job, requestImagesFromBackend, {
                            source: policySafeRetry ? "policy-safe-retry" : "manual-retry",
                            prompt: job.prompt,
                            policySafeRetry,
                        });
                        addGenerationHistoryRecord(createGenerationHistoryRecord({
                            source: policySafeRetry ? "policy-safe-retry" : "manual-retry",
                            mode: job.mode,
                            prompt: job.prompt,
                            jobs: [job],
                            status: job.status,
                        }));
                        setStatus(`${job.title || "任务"} 重试完成`, job.status === "succeeded" ? "success" : "warning");
                    } catch (error) {
                        setStatus(`${job.title || "任务"} 重试失败：${error?.message || error}`, "error");
                    }
                    renderPlanProgress(list);
                    renderManualPreview([], "", list);
                })
                .appendTo(card);
        }
        card.appendTo(box);
    }
}

async function manualGenerate() {
    const fp = $("#oair_floating_panel");
    let prompt = String(fp.find("#oair_manual_prompt").val() || "").trim();
    if (!prompt) {
        toastr.warning("请先输入提示词。");
        return;
    }

    const settings = extension_settings[extensionName];
    setStatus("手动生图中...", "info");
    setButtonLoading("#oair_btn_manual_gen", true);
    $("#oair_fab").addClass("oair-fab--loading");

    try {
        let result;
        // 根据生成模式选择执行路径（single | multi | comic）；
        // 手动精修结果只在单图分支使用——comic/multi 需要原始剧情文本来拆分分镜/节点
        const mode = normalizeGenerationMode(settings.generationMode || (settings.multiImageEnabled ? "multi" : "single"));
        let effectiveMode = mode;
        if (mode === "comic") {
            effectiveMode = "comic";
            // 漫画模式：LLM 分镜 → 逐格生成，对白元数据随结果保留
            const panelCount = normalizeComicPanelCount(settings.comicPanelCount);
            const dialogueEnabled = settings.comicDialogueEnabled !== false;
            const dialogueMode = normalizeComicDialogueMode(settings.comicDialogueMode);
            const failurePolicy = normalizePlanFailurePolicy(settings.comicFailurePolicy);
            const planOptions = await buildManualPlanOptions(prompt, { panelCount, dialogueEnabled, dialogueMode, failurePolicy });
            result = await runComicImagePlan(prompt, {}, { source: "manual-comic", policyAutoRetry: false }, planOptions);
            // 按成功 job 数统计：imageCount>1 时一个 job 可返回多张图，用 images.length 会虚报
            const okCount = result.jobs.filter((j) => j.status === "succeeded").length;
            setStatus(`漫画模式：成功 ${okCount} / ${panelCount} 格`, okCount === panelCount ? "success" : "warning");
        } else if (mode === "multi" || settings.multiImageEnabled) {
            effectiveMode = "multi";
            // 多图模式：拆分 StoryBeat，每个 beat 独立生成
            const beatCount = normalizeBeatCount(settings.defaultBeatCount);
            const failurePolicy = normalizePlanFailurePolicy(settings.multiImageFailurePolicy);
            const planOptions = await buildManualPlanOptions(prompt, { beatCount, failurePolicy });
            result = await runMultiImagePlan(prompt, {}, { source: "manual", policyAutoRetry: false }, planOptions);
            const okCount = result.jobs.filter((j) => j.status === "succeeded").length;
            setStatus(`多图模式：成功 ${okCount} / ${beatCount} 张`, okCount === beatCount ? "success" : "warning");
        } else {
            effectiveMode = "single";
            // 单图模式：先规划并编译；如果有手动精修结果，则作为最终 prompt 覆盖编译结果。
            const optimizedText = String(fp.find("#oair_manual_optimized_text").text() || "").trim();
            const planOptions = await buildManualPlanOptions(prompt, {});
            result = await runSingleImagePlan(prompt, {
                skipOptimize: !!optimizedText,
                promptOverride: optimizedText,
                forceOptimize: false,
                fixed: planOptions.fixed,
            }, { source: "manual", policyAutoRetry: false }, planOptions);
            prompt = result.jobs?.[0]?.prompt || prompt;
        }

        manualWorkbenchState.lastJobs = result.jobs || [];
        renderPlanProgress(result.jobs);
        renderManualPreview(result.images, result.content, result.jobs);
        addGenerationHistoryRecord(createGenerationHistoryRecord({
            source: effectiveMode === "comic" ? "manual-comic" : "manual",
            mode: effectiveMode,
            prompt,
            plan: result.plan,
            jobs: result.jobs,
            status: result.images.length ? "succeeded" : "failed",
        }));

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
        toastr.warning("请先在「模型后端」里启用编译后精修功能。");
        return;
    }

    setStatus("正在精修编译提示词...", "info");
    setButtonLoading("#oair_btn_optimize", true);

    try {
        const fixed = await resolveFixedSettings(prompt, settings);
        const previewPlan = createSingleImagePlan(prompt, {
            fixed,
            strategy: settings.singleImageStrategy,
        });
        await finalizeImagePlanPrompts(previewPlan, { fixed, forceOptimize: true });
        const optimized = previewPlan.jobs?.[0]?.prompt || previewPlan.jobs?.[0]?.compiledPrompt || prompt;
        if (optimized) {
            fp.find("#oair_manual_optimized_text").text(optimized);
            fp.find("#oair_manual_optimized_prompt").show();
            const source = previewPlan.jobs?.[0]?.promptDiagnostics?.finalPromptSource || "compiled";
            setStatus(source === "refined" ? "编译提示词已精修" : "编译提示词已预检", "success");
            toastr.success("提示词预检完成，可查看结果。");
        } else {
            setStatus("预检失败，将使用当前提示词", "warning");
        }
    } catch (error) {
        console.error(`[${extensionName}] Manual optimization failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        setButtonLoading("#oair_btn_optimize", false);
    }
}

/**
 * 手动生图预览。jobs 可选：多图/漫画模式传入后，按格/节点展示标题、对白元数据与失败标记。
 * （为后续 HTML/CSS 气泡叠加与整页合成保留的 UI 插槽：.oair-panel-card / .oair-panel-dialogue）
 * manualPreviewEpoch：每次重渲染递增；旧 plan 的重试回调完成后若已有新一轮预览则放弃重绘，避免覆盖。
 */
let manualPreviewEpoch = 0;

function makePreviewImageAccessible(image, label, open) {
    return image
        .attr("role", "button")
        .attr("tabindex", "0")
        .attr("alt", label)
        .on("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
}

function getJobDialogueMode(job) {
    return String(job?.dialogueMode || job?.promptDiagnostics?.dialogueMode || (job?.mode === "comic" ? "bubble" : "")).trim();
}

function parseDialogueLine(line) {
    const text = String(line || "").trim();
    const match = text.match(/^([^：:]{1,16})[：:]\s*(.+)$/);
    if (!match) return { speaker: "", text };
    return { speaker: match[1].trim(), text: match[2].trim() };
}

function appendComicBubbleLayer(frame, job) {
    const mode = getJobDialogueMode(job);
    if (mode !== "bubble") return;
    const lines = Array.isArray(job?.dialogue) ? job.dialogue.filter(Boolean).slice(0, 3) : [];
    const caption = String(job?.caption || "").trim();
    if (!lines.length && !caption) return;

    const layer = $("<div></div>").css({
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "10px",
        boxSizing: "border-box",
        gap: "8px",
    });

    if (caption) {
        $("<div></div>")
            .text(caption)
            .css({
                alignSelf: "flex-start",
                maxWidth: "82%",
                padding: "5px 8px",
                borderRadius: "6px",
                background: "rgba(0,0,0,0.66)",
                color: "#f7f7f7",
                fontSize: "12px",
                lineHeight: 1.35,
                boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
            })
            .appendTo(layer);
    } else {
        $("<div></div>").appendTo(layer);
    }

    const row = $("<div></div>").css({
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        alignItems: "flex-end",
        justifyContent: "center",
    });
    for (const [index, rawLine] of lines.entries()) {
        const parsed = parseDialogueLine(rawLine);
        const bubble = $("<div></div>").css({
            maxWidth: lines.length === 1 ? "86%" : "46%",
            minWidth: "0",
            padding: "7px 9px",
            borderRadius: "14px",
            background: "rgba(255,255,255,0.92)",
            color: "#171717",
            border: "1px solid rgba(0,0,0,0.2)",
            boxShadow: "0 3px 12px rgba(0,0,0,0.32)",
            fontSize: "12px",
            lineHeight: 1.35,
            textAlign: "left",
            transform: index % 2 ? "translateY(-3px)" : "translateY(0)",
        });
        if (parsed.speaker) {
            $("<strong></strong>")
                .text(parsed.speaker)
                .css({ display: "block", fontSize: "10px", opacity: 0.7, marginBottom: "2px" })
                .appendTo(bubble);
        }
        $("<span></span>").text(parsed.text).appendTo(bubble);
        bubble.appendTo(row);
    }
    row.appendTo(layer);
    layer.appendTo(frame);
}

function renderManualPreview(images, content = "", jobs = null) {
    const epoch = ++manualPreviewEpoch;
    const fp = $("#oair_floating_panel");
    const preview = fp.find("#oair_manual_preview");
    preview.empty();

    const directImages = Array.isArray(images) ? images : [];
    const richJobs = Array.isArray(jobs)
        ? jobs.filter((job) => job && (
            job.mode === "comic"
            || job.mode === "multi"
            || (!directImages.length && Array.isArray(job.result?.images) && job.result.images.length > 0)
        ))
        : [];

    if (richJobs.length > 0) {
        const previewImages = richJobs.map((job) => job?.result?.images?.[0]).filter(Boolean);
        // 按 job 顺序逐格/逐节点展示：成功格显示图片 + 对白；失败格显示错误标记
        for (const job of richJobs) {
            const card = $("<div>").addClass("oair-preview-card oair-panel-card");
            $("<div>")
                .addClass("oair-preview-title")
                .text(job.status === "failed" ? `${job.title || "分格"} ✕ 失败：${getImageJobFailureSummary(job)}` : (job.title || ""))
                .appendTo(card);
            if (job.status === "failed" && job.error && job.error !== job.errorSummary) {
                $("<div>")
                    .addClass("oair-error-summary")
                    .text(job.error)
                    .appendTo(card);
            }
            const url = job.result?.images?.[0];
            if (url) {
                const frame = $("<div></div>").addClass("oair-preview-thumb").appendTo(card);
                makePreviewImageAccessible(
                    $("<img>")
                        .attr("src", url)
                        .on("click", () => openImageLightbox(url, previewImages)),
                    `${job.title || "分格"} 预览图`,
                    () => openImageLightbox(url, previewImages),
                ).appendTo(frame);
                appendComicBubbleLayer(frame, job);
            }
            if (job.status === "failed" && job.retryable) {
                // 单格重试：只重跑该格的 prompt，完成后原位重渲染卡片列表
                const policySafeRetry = canUsePolicySafeRetry(job);
                $('<button type="button" class="menu_button" style="width:100%; justify-content:center; margin-top:6px;"></button>')
                    .text(policySafeRetry ? "安全重试" : "↻ 重试本格")
                    .on("click", async function () {
                        $(this).prop("disabled", true).text("重试中...");
                        try {
                            await retryImageJob(job, requestImagesFromBackend, {
                                source: policySafeRetry ? "policy-safe-retry" : "manual-retry",
                                prompt: job.prompt,
                                policySafeRetry,
                            });
                            addGenerationHistoryRecord(createGenerationHistoryRecord({
                                source: policySafeRetry ? "policy-safe-retry" : "manual-retry",
                                mode: job.mode,
                                prompt: job.prompt,
                                jobs: [job],
                                status: job.status,
                            }));
                            setStatus(`${job.title || "分格"} 重试成功`, "success");
                        } catch (error) {
                            setStatus(`${job.title || "分格"} 重试失败：${error?.message || error}`, "error");
                        }
                        // epoch 防护：重试期间用户可能已生成新一轮预览，旧回调不得覆盖
                        if (epoch !== manualPreviewEpoch) return;
                        renderPlanProgress(richJobs);
                        renderManualPreview([], "", richJobs);
                    })
                    .appendTo(card);
            }
            const dialogueLines = Array.isArray(job.dialogue) ? job.dialogue.filter(Boolean) : [];
            if (dialogueLines.length > 0) {
                $("<div>")
                    .addClass("oair-panel-dialogue")
                    .text(`对白：${dialogueLines.join("　")}`)
                    .css({ fontSize: "0.75em", opacity: 0.75, marginTop: "6px", lineHeight: 1.5 })
                    .appendTo(card);
            }
            card.appendTo(preview);
        }
        return;
    }

    for (const imageUrl of images) {
        const card = $("<div>").addClass("oair-preview-card");
        const frame = $("<div>").addClass("oair-preview-thumb").appendTo(card);
        makePreviewImageAccessible(
            $("<img>")
                .attr("src", imageUrl)
                .on("click", () => openImageLightbox(imageUrl, images)),
            "生成图片预览",
            () => openImageLightbox(imageUrl, images),
        ).appendTo(frame);
        card.appendTo(preview);
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

/**
 * 图片灯箱：全屏遮罩查看大图。兼容 data:URI（浏览器禁止 window.open 打开 data: 链接）与普通 URL。
 * 点击遮罩或按 Esc 关闭；有同组图片时支持按钮与左右方向键切换。
 */
function openImageLightbox(src, collection = []) {
    $("#oair_lightbox").remove();
    const images = dedupeStrings([...(Array.isArray(collection) ? collection : []), src]).filter(Boolean);
    let index = Math.max(0, images.indexOf(src));
    const overlay = $('<div id="oair_lightbox"></div>')
        .attr("role", "dialog")
        .attr("aria-modal", "true")
        .attr("aria-label", "图片预览")
        .attr("tabindex", "-1")
        .css({
            position: "fixed",
            left: 0,
            top: 0,
            width: "100vw",
            height: "100vh",
            minHeight: "100dvh",
            zIndex: 100000,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
            padding: "20px",
            boxSizing: "border-box",
            overflow: "hidden",
        });
    const image = $("<img>")
        .attr("src", src)
        .attr("alt", "生成图片预览")
        .css({ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "6px", boxShadow: "0 4px 30px rgba(0,0,0,0.6)", cursor: "default" })
        .appendTo(overlay);

    const counter = $("<div></div>").css({
        position: "absolute",
        left: "50%",
        bottom: "18px",
        transform: "translateX(-50%)",
        color: "#fff",
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "999px",
        padding: "4px 10px",
        fontSize: "12px",
        lineHeight: 1,
        display: images.length > 1 ? "block" : "none",
    }).appendTo(overlay);

    const showAt = (nextIndex) => {
        if (!images.length) return;
        index = (nextIndex + images.length) % images.length;
        image.attr("src", images[index]);
        counter.text(`${index + 1} / ${images.length}`);
    };

    const navButton = (label, title, side, delta) => $("<button type=\"button\"></button>")
        .text(label)
        .attr("title", title)
        .css({
            position: "absolute",
            top: "50%",
            [side]: "18px",
            transform: "translateY(-50%)",
            width: "42px",
            height: "54px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.46)",
            color: "#fff",
            fontSize: "28px",
            lineHeight: 1,
            cursor: "pointer",
            display: images.length > 1 ? "flex" : "none",
            alignItems: "center",
            justifyContent: "center",
        })
        .on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            showAt(index + delta);
        })
        .appendTo(overlay);

    navButton("‹", "上一张", "left", -1);
    navButton("›", "下一张", "right", 1);
    $('<button type="button"></button>')
        .text("×")
        .attr("title", "关闭")
        .css({
            position: "absolute",
            top: "16px",
            right: "18px",
            width: "36px",
            height: "36px",
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(0,0,0,0.46)",
            color: "#fff",
            fontSize: "22px",
            lineHeight: 1,
            cursor: "pointer",
        })
        .on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            close();
        })
        .appendTo(overlay);

    const close = () => {
        overlay.remove();
        $(document).off("keydown.oair_lightbox");
    };
    overlay.on("click", (e) => {
        if (e.target === overlay[0]) close();
    });
    $(document).off("keydown.oair_lightbox").on("keydown.oair_lightbox", (e) => {
        if (e.key === "Escape") close();
        if (e.key === "ArrowLeft" && images.length > 1) showAt(index - 1);
        if (e.key === "ArrowRight" && images.length > 1) showAt(index + 1);
    });
    $("body").append(overlay);
    showAt(index);
    overlay[0]?.focus?.();
}

// ═══════════════════════════════════════════════════════════════
// SECTION 13: MESSAGE IMAGE GENERATION (feat 6 & 7)
// ═══════════════════════════════════════════════════════════════

function injectMessageActionsForVisibleMessages() {
    $("#chat .mes[mesid]").each((_, element) => {
        const id = Number(element.getAttribute("mesid"));
        if (Number.isInteger(id)) onMessageRendered(id);
    });
}

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

    let prompt = cleanRpText(message.mes).trim();
    if (!prompt) {
        toastr.warning("消息内容为空。");
        return;
    }

    const inFlightKey = `msg:${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) return;
    inFlightMessages.add(inFlightKey);

    try {
        setStatus("正在从消息生图...", "info");
        const result = await runSingleImagePlan(prompt, { forceOptimize: false }, { source: "message" });
        prompt = result.jobs?.[0]?.prompt || prompt;
        addGenerationHistoryRecord(createGenerationHistoryRecord({
            source: "message",
            mode: "single",
            prompt,
            plan: result.plan,
            jobs: result.jobs,
            status: result.images.length ? "succeeded" : "failed",
        }));

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "message-gen",
            };
            // 仅附加图片，不重新渲染正文——保留该消息已渲染的 HTML
            await updateMessageBlockWhenReady(messageId, message, { rerenderMessage: false });
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
        const prompt = await summarizeMessageToPrompt(cleanRpText(message.mes));
        if (!prompt) {
            setStatus("总结失败", "warning");
            toastr.warning("消息总结失败，请检查优化配置。");
            return;
        }

        setStatus("正在规划并生图...", "info");
        const result = await runSingleImagePlan(prompt, { forceOptimize: false }, { source: "summarize", prompt }, { sourceText: prompt });
        addGenerationHistoryRecord(createGenerationHistoryRecord({
            source: "summarize",
            mode: "single",
            prompt,
            plan: result.plan,
            jobs: result.jobs,
            status: result.images.length ? "succeeded" : "failed",
        }));

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "summarize-gen",
            };
            // 仅附加图片，不重新渲染正文——保留该消息已渲染的 HTML
            await updateMessageBlockWhenReady(messageId, message, { rerenderMessage: false });
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

function normalizeSingleImageStrategy(value) {
    const key = String(value || "").trim();
    return ["climax", "poster", "final"].includes(key) ? key : DEFAULT_SINGLE_IMAGE_STRATEGY;
}

/**
 * 精修模板渲染：替换 {{style}}/{{characters}}/{{scenes}}/{{prompt}}；空值给中性兜底文案。
 */
function renderOptimizeTemplate(template, { prompt, style, characters, scenes, singleStrategy } = {}) {
    const src = String(template || defaultSettings.optimizeTemplate);
    const styleText = String(style || "").trim() || "保持画面整体协调即可";
    const charText = String(characters || "").trim() || "（本图无需固定角色设定）";
    const sceneText = String(scenes || "").trim() || "（本图无需固定场景设定）";
    const strategyKey = normalizeSingleImageStrategy(singleStrategy || extension_settings?.[extensionName]?.singleImageStrategy);
    const strategyText = SINGLE_IMAGE_STRATEGY_LABELS[strategyKey] || SINGLE_IMAGE_STRATEGY_LABELS[DEFAULT_SINGLE_IMAGE_STRATEGY];
    return src
        .replace(/\{\{\s*singleStrategy\s*\}\}/g, strategyText)
        .replace(/\{\{\s*style\s*\}\}/g, styleText)
        .replace(/\{\{\s*characters\s*\}\}/g, charText)
        .replace(/\{\{\s*scenes\s*\}\}/g, sceneText)
        .replace(/\{\{\s*prompt\s*\}\}/g, String(prompt || "").trim());
}

/**
 * 模板是否含精修模板占位符（{{style}} / {{characters}} / {{scenes}} / {{singleStrategy}}）。
 * 无则走旧的仅 {{prompt}} 渲染。
 */
function optimizeHasSlots(template) {
    return /\{\{\s*(style|characters|scenes|singleStrategy)\s*\}\}/.test(String(template || ""));
}

function optimizeHasFixedReferenceSlots(template) {
    return /\{\{\s*(style|characters|scenes)\s*\}\}/.test(String(template || ""));
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
 * 获取自定义精修 LLM 后端的模型列表
 */
async function fetchOptimizeModelList() {
    const settings = extension_settings[extensionName];
    const serviceUrl = String(settings.optimizeApiUrl || "").trim();
    const apiKey = String(settings.optimizeApiKey || "").trim();

    if (!serviceUrl) {
        throw new Error("请先填写精修 LLM 服务地址");
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

/**
 * 清洗 RP 消息文本：剥离游戏系统块（骰子/状态/动作选项/总结/思考等）与说话人标签，
 * 只保留可用于生图的叙事正文。用于「导入消息」及消息生图，避免系统噪声稀释画面细节。
 */
function cleanRpText(raw) {
    let s = String(raw || "");

    // 1. 移除整段非画面系统块（标签 + 内容）
    const blockTags = [
        "think", "thinking", "reasoning",
        "DiceCheck", "dice", "UpdateVariable", "update_analysis", "json_patch",
        "action", "actions", "summary", "status", "StatusBlock", "statusbar", "state",
    ];
    for (const tag of blockTags) {
        s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
    }

    // 2. 若存在叙事正文容器，优先取其内容（now_plot / content）
    const plot = s.match(/<now_plot\b[^>]*>([\s\S]*?)<\/now_plot>/i);
    if (plot && plot[1].trim()) {
        s = plot[1];
    } else {
        const content = s.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i);
        if (content && content[1].trim()) s = content[1];
    }

    // 3. 去掉自闭合占位标签与其余 XML 式标签，仅保留文字
    s = s.replace(/<[a-zA-Z_][\w-]*\b[^>]*\/>/g, "");
    s = s.replace(/<\/?[a-zA-Z_][\w-]*\b[^>]*>/g, "");

    // 4. 去掉说话人标签 {名字}，保留台词文字
    s = s.replace(/\{[^{}\n]{1,24}\}/g, "");

    // 5. 压缩多余空白
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    // 兜底：清洗后为空则退回较轻的纯标签剥离，再不行用原文
    if (!s) {
        try { s = stripHtmlTags(raw).trim(); } catch { s = ""; }
    }
    return s || String(raw || "").trim();
}

/**
 * 从世界书条目正文里抽取"相关段"：按小节标题（外貌/场景/appearance...）定位，
 * 取冒号后内容直到空行/下一个小节标题/结尾；抽不到则返回整条。单条截到 300 字。
 */
function extractEntrySection(content, headings) {
    const text = String(content || "");
    if (!text.trim()) return "";
    const MAX = 300;
    const heads = (Array.isArray(headings) ? headings : [])
        .map((h) => String(h || "").trim().toLowerCase())
        .filter(Boolean);
    const lines = text.split(/\r?\n/);
    const headingLabel = (line) => {
        const m = line.match(/^\s*([^\n：:]{1,16})\s*[:：]/);
        return m ? m[1].trim() : null;
    };
    for (let i = 0; i < lines.length; i++) {
        const label = headingLabel(lines[i]);
        if (label && heads.includes(label.toLowerCase())) {
            const after = lines[i].replace(/^\s*[^\n：:]{1,16}\s*[:：]\s*/, "").trim();
            const buf = [];
            if (after) buf.push(after);
            for (let j = i + 1; j < lines.length; j++) {
                if (!lines[j].trim()) break;            // 空行
                if (headingLabel(lines[j])) break;      // 下一个小节标题
                buf.push(lines[j].trim());
            }
            const body = buf.join(" ").trim();
            if (body) return `${label}：${body}`.slice(0, MAX);
        }
    }
    return text.trim().slice(0, MAX);
}

/**
 * 手动外貌兜底：解析 characterAppearance 的「名字：外貌」行，返回出现在 prompt 中、
 * 且未被世界书覆盖（covered）的条目 [{name, text}]。无「名字：」格式时整体作一条。
 */
function collectManualAppearances(prompt, appearanceText, covered = new Set()) {
    const base = String(prompt || "");
    const raw = String(appearanceText || "").trim();
    if (!raw) return [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    let parsedAny = false;
    for (const line of lines) {
        const m = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
        if (m) {
            parsedAny = true;
            const name = m[1].trim();
            if (covered.has(name)) continue;
            if (base.includes(name)) out.push({ name, text: line });
        }
    }
    if (!parsedAny) out.push({ name: "", text: raw });
    return out;
}

/**
 * 聚合当前激活的世界书名：聊天绑定（chatMetadata.world_info）+ 角色卡主书
 * （characters[id].data.extensions.world）。任一字段缺失则忽略，最终去重去空。
 */
function getActiveWorldBookNames() {
    const names = [];
    try {
        const ctx = getContext();
        const chatBook = ctx?.chatMetadata?.world_info;
        if (typeof chatBook === "string") names.push(chatBook);
        else if (Array.isArray(chatBook)) names.push(...chatBook);
        const charId = ctx?.characterId;
        const charBook = ctx?.characters?.[charId]?.data?.extensions?.world;
        if (typeof charBook === "string") names.push(charBook);
    } catch (e) {
        console.warn(`[${extensionName}] getActiveWorldBookNames failed`, e);
    }
    return dedupeStrings(names.filter((n) => typeof n === "string" && n.trim()));
}

// 世界书条目缓存：按激活书名签名缓存，CHAT_CHANGED 时清空
let worldBookCache = { sig: null, entries: null };

function clearWorldBookCache() {
    worldBookCache = { sig: null, entries: null };
}

/**
 * 加载当前激活世界书的全部可用条目，归一成 {keys, content, comment}。
 * 滤掉 disable / 无内容 / 无长度≥2关键词的条目。带缓存。
 */
async function loadActiveWorldBookEntries() {
    const ctx = getContext();
    if (typeof ctx?.loadWorldInfo !== "function") return [];
    const names = getActiveWorldBookNames();
    if (!names.length) return [];
    const sig = names.join("|");
    if (worldBookCache.sig === sig && worldBookCache.entries) return worldBookCache.entries;

    const all = [];
    for (const name of names) {
        try {
            const data = await ctx.loadWorldInfo(name);
            const entries = data?.entries;
            if (!entries) continue;
            for (const uid of Object.keys(entries)) {
                const e = entries[uid];
                if (!e || e.disable === true) continue;
                const keys = [
                    ...(Array.isArray(e.key) ? e.key : []),
                    ...(Array.isArray(e.keysecondary) ? e.keysecondary : []),
                ].map((k) => String(k || "").trim()).filter((k) => k.length >= 2);
                if (!keys.length || !String(e.content || "").trim()) continue;
                all.push({ keys, content: String(e.content), comment: String(e.comment || "") });
            }
        } catch (err) {
            console.warn(`[${extensionName}] loadWorldInfo(${name}) failed`, err);
        }
    }
    worldBookCache = { sig, entries: all };
    return all;
}

/**
 * 解析「名字：描述」多行库文本（风格库 / 人物库共用），返回 [{name, body, raw}]。
 * 名字限 1-24 字、用中/英文冒号分隔；不合格的行跳过。
 */
function parseNamedLibrary(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
        if (m) out.push({ name: m[1].trim(), body: m[2].trim(), raw: t });
    }
    return out;
}

function serializeNamedLibrary(items) {
    return (items || [])
        .map((item) => {
            const name = String(item?.name || "").trim();
            const body = String(item?.body || "").trim();
            return name && body ? `${name}：${body}` : "";
        })
        .filter(Boolean)
        .join("\n");
}

function addNamedLibraryItems(existingText, newItems) {
    const list = parseNamedLibrary(existingText);
    const seen = new Set(list.map((item) => item.name));
    for (const item of (newItems || [])) {
        const name = String(item?.name || "").trim();
        const body = String(item?.body || "").trim();
        if (!name || !body) continue;
        if (seen.has(name)) {
            const old = list.find((x) => x.name === name);
            if (old && !old.body.includes(body)) old.body = `${old.body}；${body}`;
        } else {
            seen.add(name);
            list.push({ name, body, raw: `${name}：${body}` });
        }
    }
    return serializeNamedLibrary(list);
}

/**
 * 按风格名从风格库取描述：精确匹配优先，再松匹配（互为子串）；找不到/名字空 → 返回 ""。
 */
function resolveStyleText(settings, styleName) {
    const want = String(styleName || "").trim();
    if (!want) return "";
    const lib = parseNamedLibrary(settings.styleLibrary);
    const exact = lib.find((s) => s.name === want);
    if (exact) return exact.body;
    const loose = lib.find((s) => s.name.includes(want) || want.includes(s.name));
    return loose ? loose.body : "";
}

function resolveLibraryText(libraryText, name) {
    const want = String(name || "").trim();
    if (!want) return "";
    const lib = parseNamedLibrary(libraryText);
    const exact = lib.find((item) => item.name === want);
    if (exact) return exact.body;
    const loose = lib.find((item) => item.name.includes(want) || want.includes(item.name));
    return loose ? loose.body : "";
}

function collectLibraryItemsByPrompt(prompt, libraryText) {
    const base = String(prompt || "");
    return parseNamedLibrary(libraryText)
        .filter((item) => item.name && base.includes(item.name))
        .map((item) => ({ name: item.name, text: `${item.name}：${item.body}` }));
}

function worldBookMode(settings) {
    const mode = String(settings?.worldBookMode || "").trim();
    if (["off", "inject", "extract"].includes(mode)) return mode;
    return settings?.worldBookEnabled ? "inject" : "off";
}

function libraryWorldBookMode(settings, kind) {
    const key = kind === "scene" ? "sceneWorldBookMode" : "characterWorldBookMode";
    const mode = String(settings?.[key] || "").trim();
    if (["off", "inject", "extract"].includes(mode)) return mode;
    return worldBookMode(settings);
}

function normalizeWorldBookModes(settings, flags = {}) {
    const legacy = worldBookMode(settings);
    if (!flags.hadCharacterMode) settings.characterWorldBookMode = legacy;
    if (!flags.hadSceneMode) settings.sceneWorldBookMode = legacy;
    settings.characterWorldBookMode = libraryWorldBookMode(settings, "character");
    settings.sceneWorldBookMode = libraryWorldBookMode(settings, "scene");
    settings.worldBookMode = (settings.characterWorldBookMode === settings.sceneWorldBookMode)
        ? settings.characterWorldBookMode
        : "off";
    settings.worldBookEnabled = settings.characterWorldBookMode === "inject" || settings.sceneWorldBookMode === "inject";
}

/**
 * 去重 + 按总字数封顶：从 [{text}] 取不重复文本累加，超过 maxChars 即停，返回换行拼接串。
 */
function pickCappedText(items, maxChars) {
    const cap = Number(maxChars) || 800;
    const seen = new Set();
    const picked = [];
    let total = 0;
    for (const item of (items || [])) {
        const t = String(item?.text || "").trim();
        if (!t || seen.has(t)) continue;
        if (total + t.length > cap) break;
        seen.add(t);
        picked.push(t);
        total += t.length;
    }
    return picked.join("\n");
}

/**
 * 降级路径：把固定设定（风格 + 人物）拼成【设定参考】块追加到 prompt 末尾。
 * 两者皆空则原样返回。供「优化关闭 / 老模板无占位符 / 总结生图」复用。
 */
function appendFixedBlock(prompt, fixed) {
    const base = String(prompt || "");
    const parts = [];
    const style = String(fixed?.styleText || "").trim();
    const chars = String(fixed?.charactersText || "").trim();
    const scenes = String(fixed?.scenesText || "").trim();
    if (style) parts.push(`风格：${style}`);
    if (chars) parts.push(chars);
    if (scenes) parts.push(scenes);
    if (!parts.length) return base;
    return `${base}\n\n【设定参考】\n${parts.join("\n")}`;
}

/**
 * 按名取人物（LLM 识别路）：解析 characterAppearance「名字：外貌」行，
 * 名字与 names 互为子串即命中（容错别名/全名），跳过 covered。返回 [{name, text}]。
 */
function collectManualAppearancesByNames(appearanceText, names, covered = new Set()) {
    const raw = String(appearanceText || "").trim();
    if (!raw || !Array.isArray(names) || !names.length) return [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
        const m = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
        if (!m) continue;
        const name = m[1].trim();
        if (covered.has(name)) continue;
        if (names.some((n) => String(n).includes(name) || name.includes(String(n)))) {
            out.push({ name, text: line });
        }
    }
    return out;
}

/**
 * 宽松抽取文本中首个 {...} JSON 片段并解析为【原始对象】；失败返回 null。
 * 供 parseAnalysisJson / splitStoryBeats / splitComicPanels 共用——
 * 后两者需要 beats/panels 等原始字段，不能用归一化后的场景分析结果。
 */
function parseRawJsonObject(text) {
    const m = String(text || "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
}

/**
 * 宽松解析分析调用返回：抽首个 {...} JSON 片段，归一成 {characters:string[], style:string, scene:string}。
 * 解析失败 / 字段缺失 → 返回空结果（由上层降级）。
 */
function parseAnalysisJson(text) {
    const obj = parseRawJsonObject(text);
    const characters = Array.isArray(obj?.characters)
        ? obj.characters.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
    const style = obj && obj.style != null ? String(obj.style).trim() : "";
    const scene = obj && obj.scene != null ? String(obj.scene).trim() : "";
    return { characters, style, scene };
}

/**
 * 一次轻量分析调用：喂场景原文 + 候选人物名 + 候选风格名，要求输出紧凑 JSON。
 * 走 callLlmForText（主聊天模型 / 自定义文本后端），不经图片后端。失败由调用方兜回。
 */
async function analyzeSceneForFixed(prompt, { charNames = [], styleNames = [], sceneNames = [] } = {}) {
    const settings = extension_settings[extensionName];
    const template = settings.analysisTemplate || defaultSettings.analysisTemplate;
    const userMessage = String(template)
        .replaceAll("{{characters}}", charNames.join("、") || "（无）")
        .replaceAll("{{styles}}", styleNames.join("、") || "（无）")
        .replaceAll("{{scenes}}", sceneNames.join("、") || "（无）")
        .replaceAll("{{prompt}}", String(prompt || "").trim());
    const systemPrompt = "你是一个图片场景分析助手，只输出 JSON。";
    const result = await callLlmForText(systemPrompt, userMessage);
    return parseAnalysisJson(result);
}

/**
 * 收集出场人物的逐字描述条目 [{name, text}]：
 * names 为数组 → LLM 识别路（按名匹配世界书/人物库）；names 为 null → 子串匹配路（现有行为）。
 * 世界书优先并记 covered，人物库补未覆盖者。
 */
async function gatherCharacterItems(base, settings, names) {
    const collected = [];
    const covered = new Set();
    const useNames = Array.isArray(names);
    const rel = (a, b) => { a = String(a); b = String(b); return a.includes(b) || b.includes(a); };

    if (libraryWorldBookMode(settings, "character") === "inject") {
        try {
            const entries = await loadActiveWorldBookEntries();
            const headings = String(settings.worldBookSectionHeadings || "")
                .split(/[,，]/).map((h) => h.trim()).filter(Boolean);
            for (const e of entries) {
                let hit = null;
                if (useNames) {
                    hit = names.find((n) => e.keys.some((k) => rel(n, k)) || (e.comment && rel(n, e.comment)));
                } else {
                    hit = e.keys.find((k) => base.includes(k));
                }
                if (!hit) continue;
                const section = extractEntrySection(e.content, headings);
                if (!section) continue;
                collected.push({ name: e.comment || hit, text: section });
                e.keys.forEach((k) => covered.add(k));
                if (e.comment) covered.add(e.comment);
            }
        } catch (err) {
            console.warn(`[${extensionName}] world book gather failed`, err);
        }
    }

    if (useNames) {
        collected.push(...collectManualAppearancesByNames(settings.characterAppearance, names, covered));
    } else {
        collected.push(...collectManualAppearances(base, settings.characterAppearance, covered));
    }

    const level = normalizeVisualSanitizationLevel(settings.visualSanitizationLevel);
    const sanitized = collected
        .map((item) => ({ ...item, text: sanitizeCharacterReferenceText(item.text, level, item.name) }))
        .filter((item) => String(item.text || "").trim());
    logSanitizationSummary("人物", collected, sanitized, level);
    return sanitized;
}

async function gatherSceneItems(base, settings, sceneName = "") {
    const collected = [];
    const wanted = String(sceneName || "").trim();
    if (wanted) {
        const body = resolveLibraryText(settings.sceneLibrary, wanted);
        if (body) collected.push({ name: wanted, text: `${wanted}：${body}` });
    } else {
        collected.push(...collectLibraryItemsByPrompt(base, settings.sceneLibrary));
    }

    if (libraryWorldBookMode(settings, "scene") === "inject") {
        try {
            const entries = await loadActiveWorldBookEntries();
            const headings = String(settings.worldBookSectionHeadings || "")
                .split(/[,，]/).map((h) => h.trim()).filter(Boolean);
            for (const e of entries) {
                const hit = e.keys.find((k) => base.includes(k));
                if (!hit) continue;
                const section = extractEntrySection(e.content, headings);
                if (section) collected.push({ name: e.comment || hit, text: section });
            }
        } catch (err) {
            console.warn(`[${extensionName}] world book scene gather failed`, err);
        }
    }

    const level = normalizeVisualSanitizationLevel(settings.visualSanitizationLevel);
    const sanitized = collected
        .map((item) => ({ ...item, text: sanitizeSceneReferenceText(item.text, level) }))
        .filter((item) => String(item.text || "").trim());
    logSanitizationSummary("场景", collected, sanitized, level);
    return sanitized;
}

/**
 * 流水线 Step 0：收集固定设定（风格 + 人物 + 场景），返回 {styleText, charactersText, scenesText}。
 * 两 LLM 开关都关 → 0 调用（子串匹配 + styleActive）；任一开 → 合并一次 analyzeSceneForFixed。
 * 分析失败静默降级：人物退子串、风格退 styleActive。
 */
async function resolveFixedSettings(prompt, settings) {
    const base = String(prompt || "");
    const visualBible = resolveCurrentChatVisualBible(base, settings);
    settings = { ...settings, ...visualBible.values };
    const needLlm = !!settings.characterLlmExtract || !!settings.styleAutoSelect || !!settings.sceneAutoSelect;

    let analysis = null;
    if (needLlm) {
        try {
            const charNames = parseNamedLibrary(settings.characterAppearance).map((c) => c.name);
            const styleNames = parseNamedLibrary(settings.styleLibrary).map((s) => s.name);
            const sceneNames = parseNamedLibrary(settings.sceneLibrary).map((s) => s.name);
            if (libraryWorldBookMode(settings, "character") === "inject" || libraryWorldBookMode(settings, "scene") === "inject") {
                try {
                    const entries = await loadActiveWorldBookEntries();
                    for (const e of entries) {
                        if (e.comment) charNames.push(e.comment);
                        charNames.push(...e.keys);
                        if (e.comment) sceneNames.push(e.comment);
                        sceneNames.push(...e.keys);
                    }
                } catch (e) { /* 世界书读不到不阻断分析 */ }
            }
            analysis = await analyzeSceneForFixed(base, {
                charNames: dedupeStrings(charNames),
                styleNames,
                sceneNames: dedupeStrings(sceneNames),
            });
        } catch (err) {
            console.warn(`[${extensionName}] scene analysis failed, falling back`, err);
            analysis = null;
        }
    }

    const analysisCharacters = (analysis && Array.isArray(analysis.characters)) ? dedupeStrings(analysis.characters) : [];
    const charNames = analysisCharacters.length ? analysisCharacters : null;
    const styleName = (settings.styleAutoSelect && analysis && analysis.style)
        ? analysis.style
        : settings.styleActive;
    const sceneName = (settings.sceneAutoSelect && analysis && analysis.scene)
        ? analysis.scene
        : settings.sceneActive;

    const items = await gatherCharacterItems(base, settings, charNames);
    const charactersText = pickCappedText(items, Number(settings.worldBookMaxChars) || 800);
    const sceneItems = await gatherSceneItems(base, settings, sceneName);
    const scenesText = pickCappedText(sceneItems, Number(settings.worldBookMaxChars) || 800);
    const styleText = resolveStyleText(settings, styleName);
    return {
        styleText: styleText || visualBible.styleText,
        charactersText: charactersText || visualBible.charactersText,
        scenesText: scenesText || visualBible.scenesText,
        analysisCharacters,
        visualBible: {
            ...visualBible,
            fixed: {
                styleText: styleText || visualBible.styleText,
                charactersText: charactersText || visualBible.charactersText,
                scenesText: scenesText || visualBible.scenesText,
                analysisCharacters,
            },
            diagnostics: {
                ...(visualBible.diagnostics || {}),
                analysisCharacters,
            },
        },
    };
}

/**
 * 降级/总结路的固定设定注入：收集风格+人物+场景 → 拼【设定参考】块到末尾。
 * 旧主流水线精修路改走 resolveFixedSettings + 精修模板占位符（见 processPromptPipeline）。
 */
async function injectStableDescriptions(prompt, settings) {
    return appendFixedBlock(prompt, await resolveFixedSettings(prompt, settings));
}

// ═══════════════════════════════════════════════════════════════
// SECTION 16: IMAGE HANDLING UTILITIES
// ═══════════════════════════════════════════════════════════════

function attachGeneratedImages(message, images, titles, metadata = {}) {
    const newImages = dedupeStrings(images);
    if (!newImages.length) {
        return;
    }

    const extra = message.extra || (message.extra = {});
    const firstTitle = (Array.isArray(titles) ? titles : []).find((title) => String(title || "").trim().length > 0);
    if (metadata && typeof metadata === "object" && Object.keys(metadata).length) {
        extra[extensionName] = {
            ...(extra[extensionName] || {}),
            ...metadata,
            lastAttachmentAt: Date.now(),
        };
    }

    // 始终写新版 extra.media；自动流程可能早于 ST 的媒体包装初始化，不能依赖 getter 探测。
    const existingImages = [];
    if (Array.isArray(extra.media)) existingImages.push(...extra.media.map((m) => m && m.url).filter(Boolean));
    if (Array.isArray(extra.image_swipes)) existingImages.push(...extra.image_swipes);
    if (typeof extra.image === "string" && extra.image) existingImages.push(extra.image);

    const mergedImages = dedupeStrings([...existingImages, ...newImages]);
    if (!Array.isArray(extra.media)) extra.media = [];
    const seen = new Set(extra.media.map((m) => m && m.url).filter(Boolean));
    for (const url of mergedImages) {
        if (seen.has(url)) continue;
        seen.add(url);
        extra.media.push(firstTitle ? { type: "image", url, title: firstTitle } : { type: "image", url });
    }

    // 旧版 SillyTavern 仍读取 extra.image / image_swipes；新版 getter 存在时不要写旧字段。
    const imgDesc = Object.getOwnPropertyDescriptor(extra, "image");
    if (!imgDesc || !imgDesc.get) {
        extra.image_swipes = mergedImages;
        extra.image = mergedImages[mergedImages.length - 1];
    }

    if (extra.media.length > 1) extra.media_display = "list";
    extra.media_index = Math.max(0, extra.media.length - 1);
    extra.inline_image = true;
    if (firstTitle) extra.title = firstTitle;
}

function createDialogueAttachmentMetadata(jobs = []) {
    const dialogueJobs = (Array.isArray(jobs) ? jobs : [])
        .filter((job) => Array.isArray(job?.dialogue) && job.dialogue.some(Boolean) || String(job?.caption || "").trim())
        .map((job) => ({
            mode: String(job.mode || ""),
            index: Number(job.index) || 0,
            title: summarizeHistoryText(job.title || "", 80),
            dialogueMode: String(job.dialogueMode || job.promptDiagnostics?.dialogueMode || ""),
            dialogueEnabled: job.dialogueEnabled !== false,
            dialogue: Array.isArray(job.dialogue) ? job.dialogue.slice(0, 8).map((line) => summarizeHistoryText(line, 160)) : [],
            caption: summarizeHistoryText(job.caption || "", 160),
        }))
        .slice(0, 12);
    return dialogueJobs.length ? { dialogueJobs } : {};
}

// ═══════════════════════════════════════════════════════════════
// SECTION 17: DISK PERSISTENCE & GALLERY
// ═══════════════════════════════════════════════════════════════

const GALLERY_KEY = `${extensionName}:gallery`;
const GALLERY_MAX = 100;
const GALLERY_PAGE_SIZE = 12;
const GENERATION_HISTORY_KEY = `${extensionName}:generation-history`;
const GENERATION_HISTORY_MAX = 100;
const HISTORY_PAGE_SIZE = 10;
const historyUiPages = {
    gallery: 0,
    generation: 0,
    failed: 0,
    retry: 0,
};

/** 是否为 data:image/...;base64,... 形式的内联图 */
function isDataUri(value) {
    return /^data:image\//i.test(String(value || ""));
}

function sanitizeHistoryImages(images = []) {
    return dedupeStrings((images || []).filter((url) => url && !isDataUri(url))).slice(0, 12);
}

function summarizeHistoryText(text, maxChars = 500) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

function summarizePromptDraft(draft = null) {
    if (!draft || typeof draft !== "object") return null;
    return {
        mode: String(draft.mode || ""),
        title: summarizeHistoryText(draft.title || "", 120),
        sourceChars: String(draft.sourceText || "").length,
        cleanedChars: String(draft.cleanedText || "").length,
        visualMoment: summarizeHistoryText(draft.visualMoment, 240),
        visibleCharacters: Array.isArray(draft.visibleCharacters) ? draft.visibleCharacters.slice(0, 12).map((name) => summarizeHistoryText(name, 80)) : [],
        nonVisualCharacters: Array.isArray(draft.nonVisualCharacters) ? draft.nonVisualCharacters.slice(0, 12).map((name) => summarizeHistoryText(name, 80)) : [],
        protectedCharacters: Array.isArray(draft.protectedCharacters) ? draft.protectedCharacters.slice(0, 12).map((entry) => summarizeHistoryText(entry?.name, 80)) : [],
        protectedScenes: Array.isArray(draft.protectedScenes) ? draft.protectedScenes.slice(0, 8).map((entry) => summarizeHistoryText(entry?.name, 80)) : [],
        dialoguePolicy: String(draft.dialoguePolicy || ""),
        riskReport: {
            checked: !!draft.riskReport?.checked,
            requiresRewrite: !!draft.riskReport?.requiresRewrite,
            itemCount: Array.isArray(draft.riskReport?.items) ? draft.riskReport.items.length : 0,
        },
        validation: {
            ok: draft.validation?.ok !== false,
            reasons: Array.isArray(draft.validation?.reasons) ? draft.validation.reasons.slice(0, 8).map((reason) => summarizeHistoryText(reason, 120)) : [],
        },
        finalPrompt: summarizeHistoryText(draft.finalPrompt, 800),
    };
}

function createGenerationHistoryJob(job = {}) {
    const images = sanitizeHistoryImages(job.result?.images || job.images || []);
    return {
        id: String(job.id || ""),
        mode: String(job.mode || "single"),
        kind: String(job.kind || "text2image"),
        index: Number(job.index) || 0,
        title: String(job.title || ""),
        prompt: summarizeHistoryText(job.prompt, 800),
        compiledPrompt: summarizeHistoryText(job.compiledPrompt, 800),
        refinedPrompt: summarizeHistoryText(job.refinedPrompt, 800),
        safetyPrompt: summarizeHistoryText(job.safetyPrompt, 800),
        promptDiagnostics: summarizePromptDiagnostics(job.promptDiagnostics),
        promptDraft: summarizePromptDraft(job.promptDraft),
        sourceText: summarizeHistoryText(job.sourceText, 800),
        status: String(job.status || "pending"),
        error: summarizeHistoryText(job.error, 300),
        errorClass: String(job.errorClass || ""),
        errorSummary: summarizeHistoryText(job.errorSummary, 200),
        rawError: summarizeHistoryText(job.rawError, 300),
        retryable: !!job.retryable,
        policyRetryCount: Number(job.policyRetryCount) || 0,
        safeRetryPrompt: summarizeHistoryText(job.safeRetryPrompt, 800),
        policyOriginalPrompt: summarizeHistoryText(job.policyOriginalPrompt, 800),
        safetyRewritten: !!job.safetyRewritten,
        missingPlaceholder: !!job.missingPlaceholder,
        dialogue: Array.isArray(job.dialogue) ? job.dialogue.slice(0, 8).map((line) => summarizeHistoryText(line, 160)) : job.dialogue,
        dialogueMode: String(job.dialogueMode || job.promptDiagnostics?.dialogueMode || ""),
        caption: summarizeHistoryText(job.caption, 200),
        durationMs: Number(job.durationMs) || 0,
        images,
    };
}

function summarizePromptDiagnostics(diagnostics = {}) {
    if (!diagnostics || typeof diagnostics !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(diagnostics)) {
        if (key === "promptTrace" && Array.isArray(value)) {
            out[key] = value
                .map((entry) => ({
                    stage: summarizeHistoryText(entry?.stage || "", 80),
                    summary: summarizeHistoryText(entry?.summary || "", 220),
                }))
                .filter((entry) => entry.stage || entry.summary)
                .slice(0, 12);
        } else if (Array.isArray(value)) {
            out[key] = value.map((item) => summarizeHistoryText(item, 120)).slice(0, 12);
        } else if (value && typeof value === "object") {
            out[key] = summarizeHistoryText(JSON.stringify(value), 240);
        } else if (typeof value === "string") {
            out[key] = summarizeHistoryText(value, 160);
        } else if (typeof value === "number" || typeof value === "boolean") {
            out[key] = value;
        }
    }
    return out;
}

function createGenerationHistoryRecord(input = {}) {
    const plan = input.plan || null;
    const jobs = Array.isArray(input.jobs) ? input.jobs : (Array.isArray(plan?.jobs) ? plan.jobs : []);
    const historyJobs = jobs.map((job) => createGenerationHistoryJob(job));
    const images = sanitizeHistoryImages([
        ...(Array.isArray(input.images) ? input.images : []),
        ...historyJobs.flatMap((job) => job.images || []),
    ]);
    const failedJobCount = historyJobs.filter((job) => job.status === "failed").length;
    const retryable = historyJobs.some((job) => job.retryable);
    const mode = String(input.mode || plan?.mode || historyJobs[0]?.mode || "single");
    const status = String(input.status || (failedJobCount ? (images.length ? "partial" : "failed") : "succeeded"));
    const durationMs = Number(input.durationMs) || historyJobs.reduce((sum, job) => sum + (Number(job.durationMs) || 0), 0);
    return {
        id: String(input.id || `hist_${Date.now()}_${Math.floor(Math.random() * 1e6)}`),
        ts: Number(input.ts) || Date.now(),
        source: String(input.source || "generate"),
        mode,
        title: String(input.title || plan?.strategy || ""),
        prompt: summarizeHistoryText(input.prompt || plan?.sourceText || historyJobs[0]?.prompt || "", 800),
        status,
        imageCount: images.length,
        failedJobCount,
        durationMs,
        retryable,
        images,
        jobs: historyJobs,
    };
}

function loadGenerationHistory() {
    try {
        const arr = JSON.parse(localStorage.getItem(GENERATION_HISTORY_KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveGenerationHistory(list) {
    try {
        const normalized = (Array.isArray(list) ? list : []).slice(0, GENERATION_HISTORY_MAX);
        localStorage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(normalized));
    } catch (e) {
        console.warn(`[${extensionName}] 生成历史保存失败`, e);
    }
}

function addGenerationHistoryRecord(record) {
    if (!record) return null;
    const normalized = createGenerationHistoryRecord(record);
    const list = loadGenerationHistory().filter((item) => item && item.id !== normalized.id);
    list.unshift(normalized);
    if (list.length > GENERATION_HISTORY_MAX) list.length = GENERATION_HISTORY_MAX;
    saveGenerationHistory(list);
    refreshGenerationHistoryUi();
    return normalized;
}

function clearGenerationHistory() {
    resetHistoryUiPage("generation");
    resetHistoryUiPage("failed");
    resetHistoryUiPage("retry");
    saveGenerationHistory([]);
    refreshGenerationHistoryUi();
}

function deleteGenerationHistoryRecord(recordId) {
    const id = String(recordId || "");
    if (!id) return;
    saveGenerationHistory(loadGenerationHistory().filter((item) => item && item.id !== id));
    refreshGenerationHistoryUi();
}

/** 当前角色名作为落盘子目录（与 ST 自带 SD 出图同目录约定），非法字符替换，回退扩展名 */
function currentGallerySubFolder() {
    try {
        const ctx = getContext();
        const name = ctx?.characters?.[ctx.characterId]?.name || ctx?.name2 || "";
        const clean = String(name).trim().replace(/[\\/:*?"<>|]+/g, "_");
        return clean || extensionName;
    } catch {
        return extensionName;
    }
}

/**
 * 把单张图落盘并返回可持久访问的路径。
 * - data-URI：剥前缀取原始 base64 → saveBase64AsFile → 返回 user/images/... 路径
 * - 已是 URL（http/相对路径）：后端已托管，原样返回
 */
async function persistImageToDisk(image, subFolder) {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/is.exec(String(image || ""));
    if (!m) return image;                       // 非 data-URI（普通 URL）直接返回
    const ext = String(m[1] || "png").toLowerCase();
    const rawBase64 = m[2];                      // 后端 Buffer.from(image,'base64') 需要纯 base64（不含前缀）
    const fileName = `oair_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    return await saveBase64AsFile(rawBase64, subFolder, fileName, ext);
}

/**
 * 落盘整批图并记录图库；落盘失败静默回退原图（不入库，避免大 base64 进 localStorage）。
 * 返回换成路径后的图片数组（供附加/预览使用）。
 */
async function persistAndRecordImages(images, prompt, source, meta = {}) {
    const sub = currentGallerySubFolder();
    const out = [];
    for (const img of images) {
        let url = img;
        let recordable = !isDataUri(img);        // 普通 URL 默认可入库（后端持久）
        if (isDataUri(img)) {
            try {
                url = await persistImageToDisk(img, sub);
                recordable = true;
            } catch (e) {
                console.warn(`[${extensionName}] 图片落盘失败，回退内联 base64`, e);
                url = img;
                recordable = false;
            }
        }
        out.push(url);
        if (recordable && url) addGalleryRecord({ url, prompt, source, meta });
    }
    return out;
}

// ─── 图库存储（localStorage 仅存索引：路径 + 提示词 + 来源 + 时间） ───

function loadGallery() {
    try {
        const arr = JSON.parse(localStorage.getItem(GALLERY_KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function saveGallery(list) {
    try {
        localStorage.setItem(GALLERY_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn(`[${extensionName}] 图库保存失败`, e);
    }
}

function addGalleryRecord({ url, prompt, source, meta = {} }) {
    if (!url) return;
    const list = loadGallery();
    if (list.some((r) => r && r.url === url)) return;   // 路径去重
    list.unshift({
        url,
        prompt: String(prompt || "").slice(0, 500),
        source: source || "",
        mode: String(meta.mode || ""),
        jobId: String(meta.jobId || ""),
        promptDiagnostics: summarizePromptDiagnostics(meta.promptDiagnostics),
        promptDraft: meta.promptDraft || null,
        ts: Date.now(),
    });
    if (list.length > GALLERY_MAX) list.length = GALLERY_MAX;
    saveGallery(list);
    refreshGalleryUi();
}

function deleteGalleryRecord(url) {
    saveGallery(loadGallery().filter((r) => r && r.url !== url));
    refreshGalleryUi();
}

function clearGallery() {
    resetHistoryUiPage("gallery");
    saveGallery([]);
    refreshGalleryUi();
}

// ─── 图库 UI ──────────────────────────────────────────────────

function resetHistoryUiPage(key) {
    if (Object.prototype.hasOwnProperty.call(historyUiPages, key)) {
        historyUiPages[key] = 0;
    }
}

function getPagedUiItems(key, list, pageSize) {
    const source = Array.isArray(list) ? list : [];
    const size = Math.max(1, Number(pageSize) || 1);
    const totalPages = Math.max(1, Math.ceil(source.length / size));
    const current = Math.min(Math.max(0, Number(historyUiPages[key]) || 0), totalPages - 1);
    historyUiPages[key] = current;
    const start = current * size;
    return {
        items: source.slice(start, start + size),
        page: current,
        totalPages,
        start,
        end: Math.min(source.length, start + size),
    };
}

function appendPaginationControls(container, key, total, pageSize, rerender) {
    if (!container?.length || total <= pageSize) return;
    const pageInfo = getPagedUiItems(key, new Array(total), pageSize);
    const controls = $('<div class="oair-pagination"></div>');
    $('<button type="button" class="menu_button oair-page-btn"></button>')
        .text("上一页")
        .prop("disabled", pageInfo.page <= 0)
        .on("click", () => {
            historyUiPages[key] = Math.max(0, pageInfo.page - 1);
            rerender();
        })
        .appendTo(controls);
    $("<span>")
        .addClass("oair-pagination-info")
        .text(`${pageInfo.start + 1}-${pageInfo.end} / ${total}`)
        .appendTo(controls);
    $('<button type="button" class="menu_button oair-page-btn"></button>')
        .text("下一页")
        .prop("disabled", pageInfo.page >= pageInfo.totalPages - 1)
        .on("click", () => {
            historyUiPages[key] = Math.min(pageInfo.totalPages - 1, pageInfo.page + 1);
            rerender();
        })
        .appendTo(controls);
    container.append(controls);
}

function refreshGalleryUi() {
    const fp = $("#oair_floating_panel");
    const grid = fp.find("#oair_gallery_grid");
    if (!grid.length) return;                    // 图库面板未渲染时跳过

    const list = loadGallery();
    fp.find("#oair_gallery_count").text(`${list.length} 张`);
    grid.empty();

    if (!list.length) {
        grid.append('<div class="oair-hint" style="grid-column:1/-1; text-align:center; padding:20px;">还没有生成过图片</div>');
        return;
    }

    const galleryUrls = list.map((item) => item?.url).filter(Boolean);
    const page = getPagedUiItems("gallery", list, GALLERY_PAGE_SIZE);
    for (const rec of page.items) {
        if (!rec || !rec.url) continue;
        const cell = $('<div class="oair-gallery-cell"></div>');
        makePreviewImageAccessible(
            $("<img>")
                .attr("src", rec.url)
                .attr("title", rec.prompt || "")
                .attr("loading", "lazy")
                .on("click", () => openImageLightbox(rec.url, galleryUrls)),
            rec.prompt ? `图库图片：${String(rec.prompt).slice(0, 80)}` : "图库图片预览",
            () => openImageLightbox(rec.url, galleryUrls),
        ).appendTo(cell);

        const bar = $('<div class="oair-gallery-cell-bar"></div>');
        $('<button class="oair-gallery-mini" title="附加到当前消息">📎</button>')
            .on("click", (e) => { e.stopPropagation(); attachGalleryImageToMessage(rec.url); })
            .appendTo(bar);
        $('<button class="oair-gallery-mini" title="下载">⬇️</button>')
            .on("click", (e) => { e.stopPropagation(); downloadImage(rec.url); })
            .appendTo(bar);
        $('<button class="oair-gallery-mini" title="从图库删除（不删磁盘文件）">🗑️</button>')
            .on("click", (e) => {
                e.stopPropagation();
                if (confirm("从图库删除这条记录？（磁盘文件不会被删除）")) deleteGalleryRecord(rec.url);
            })
            .appendTo(bar);
        bar.appendTo(cell);
        grid.append(cell);
    }
    appendPaginationControls(grid, "gallery", list.length, GALLERY_PAGE_SIZE, refreshGalleryUi);
}

function formatHistoryTime(ts) {
    try {
        return new Date(Number(ts) || Date.now()).toLocaleString();
    } catch {
        return "";
    }
}

function formatHistoryStatus(status) {
    const key = String(status || "");
    if (key === "succeeded") return "成功";
    if (key === "partial") return "部分完成";
    if (key === "failed") return "失败";
    return key || "未知";
}

function appendHistoryCard(container, record, jobs = null) {
    const shownJobs = Array.isArray(jobs) ? jobs : (record.jobs || []);
    const card = $('<div class="oair-history-record"></div>').attr("data-oair-history-id", record.id || "");
    const head = $('<div class="oair-history-record-head"></div>').appendTo(card);
    $("<strong>").text(`${record.source || "generate"} / ${record.mode || "single"} / ${formatHistoryStatus(record.status)}`).appendTo(head);
    const headActions = $('<span class="oair-history-actions"></span>').appendTo(head);
    $("<span>").addClass("oair-history-time").text(formatHistoryTime(record.ts)).appendTo(headActions);
    $('<button type="button" class="menu_button oair-history-delete-btn"></button>')
        .text("删除")
        .on("click", function () {
            if (confirm("删除这条生成历史记录？")) deleteGenerationHistoryRecord(record.id);
        })
        .appendTo(headActions);
    $("<div>")
        .addClass("oair-history-meta")
        .text(`图片 ${record.imageCount || 0}，失败 ${record.failedJobCount || 0}，耗时 ${Math.round((record.durationMs || 0) / 100) / 10}s`)
        .appendTo(card);
    if (record.prompt) {
        $("<div>").addClass("oair-history-prompt").text(record.prompt).appendTo(card);
    }
    for (const job of shownJobs) {
        const row = $('<div class="oair-history-job"></div>');
        $("<span>").text(`${Number(job.index) + 1}. ${job.title || "任务"}：${formatHistoryStatus(job.status)}`).appendTo(row);
        if (job.errorSummary || job.error) {
            $("<span>").addClass("oair-history-error").text(job.errorSummary || job.error).appendTo(row);
        }
        if (job.retryable) {
            const policySafeRetry = canUsePolicySafeRetry(job);
            $('<button type="button" class="menu_button oair-history-retry-btn"></button>')
                .text(policySafeRetry ? "安全重试" : "重试")
                .on("click", async function () {
                    $(this).prop("disabled", true).text("重试中...");
                    await retryHistoryJob(record.id, job.id, { policySafeRetry });
                })
                .appendTo(row);
        }
        row.appendTo(card);
    }
    container.append(card);
}

function refreshGenerationHistoryUi() {
    const fp = $("#oair_floating_panel");
    const historyBox = fp.find("#oair_generation_history_list");
    const failedBox = fp.find("#oair_failed_history_list");
    const retryBox = fp.find("#oair_retry_history_list");
    if (!historyBox.length && !failedBox.length && !retryBox.length) return;

    const list = loadGenerationHistory();
    fp.find("#oair_generation_history_count").text(`${list.length} 条`);

    const fillEmpty = (box, text) => {
        if (box.length) box.empty().append($("<div>").addClass("oair-history-empty").text(text));
    };

    if (historyBox.length) {
        historyBox.empty();
        if (!list.length) {
            fillEmpty(historyBox, "还没有生成历史");
        } else {
            const page = getPagedUiItems("generation", list, HISTORY_PAGE_SIZE);
            for (const record of page.items) appendHistoryCard(historyBox, record);
            appendPaginationControls(historyBox, "generation", list.length, HISTORY_PAGE_SIZE, refreshGenerationHistoryUi);
        }
    }

    if (failedBox.length) {
        failedBox.empty();
        const failed = list
            .map((record) => ({ record, jobs: (record.jobs || []).filter((job) => job.status === "failed") }))
            .filter((item) => item.jobs.length);
        if (!failed.length) {
            fillEmpty(failedBox, "暂无失败记录");
        } else {
            const page = getPagedUiItems("failed", failed, HISTORY_PAGE_SIZE);
            for (const item of page.items) appendHistoryCard(failedBox, item.record, item.jobs);
            appendPaginationControls(failedBox, "failed", failed.length, HISTORY_PAGE_SIZE, refreshGenerationHistoryUi);
        }
    }

    if (retryBox.length) {
        retryBox.empty();
        const retryable = list
            .map((record) => ({ record, jobs: (record.jobs || []).filter((job) => job.retryable) }))
            .filter((item) => item.jobs.length);
        if (!retryable.length) {
            fillEmpty(retryBox, "暂无可重试任务");
        } else {
            const page = getPagedUiItems("retry", retryable, HISTORY_PAGE_SIZE);
            for (const item of page.items) appendHistoryCard(retryBox, item.record, item.jobs);
            appendPaginationControls(retryBox, "retry", retryable.length, HISTORY_PAGE_SIZE, refreshGenerationHistoryUi);
        }
    }
}

async function retryHistoryJob(recordId, jobId, options = {}) {
    const record = loadGenerationHistory().find((item) => item && item.id === recordId);
    const savedJob = record?.jobs?.find((job) => job && job.id === jobId);
    if (!record || !savedJob) {
        toastr.warning("找不到可重试的历史任务。");
        refreshGenerationHistoryUi();
        return;
    }
    const job = createImageJob({
        ...savedJob,
        status: "pending",
        retryable: false,
        result: null,
        error: "",
    });
    try {
        setStatus("正在从历史重试任务...", "info");
        const policySafeRetry = !!options.policySafeRetry && canUsePolicySafeRetry(job);
        await retryImageJob(job, requestImagesFromBackend, {
            source: policySafeRetry ? "policy-safe-retry" : "history-retry",
            prompt: job.prompt,
            policySafeRetry,
        });
        addGenerationHistoryRecord(createGenerationHistoryRecord({
            source: policySafeRetry ? "policy-safe-retry" : "history-retry",
            mode: job.mode,
            prompt: job.prompt,
            jobs: [job],
            status: job.status,
        }));
        manualWorkbenchState.lastJobs = [job];
        renderPlanProgress([job]);
        renderManualPreview(job.result?.images || [], job.result?.content || "", [job]);
        setStatus("历史任务重试完成", job.status === "succeeded" ? "success" : "warning");
        toastr.success("历史任务重试完成。");
    } catch (error) {
        addGenerationHistoryRecord(createGenerationHistoryRecord({
            source: "history-retry",
            mode: job.mode,
            prompt: job.prompt,
            jobs: [job],
            status: "failed",
        }));
        setStatus(`历史任务重试失败：${error?.message || error}`, "error");
        toastr.error(error?.message || String(error || "历史任务重试失败"));
    } finally {
        refreshGenerationHistoryUi();
    }
}

/** 把图库里的某张图附加到最后一条助手消息（复用 attachGeneratedImages，不重渲染正文） */
async function attachGalleryImageToMessage(url) {
    const context = getContext();
    const chat = context?.chat;
    if (!chat || chat.length === 0) {
        toastr.warning("当前没有聊天消息");
        return;
    }
    let msg = null;
    let idx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user && !chat[i].is_system) { msg = chat[i]; idx = i; break; }
    }
    if (!msg) { idx = chat.length - 1; msg = chat[idx]; }
    attachGeneratedImages(msg, [url], ["图库"]);
    await updateMessageBlockWhenReady(idx, msg, { rerenderMessage: false });
    try { await context.saveChat(); } catch (_) {}
    toastr.success("已附加图库图片到消息");
}

/** 触发浏览器下载（同源路径或 data-URI 均可） */
function downloadImage(url) {
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = (String(url).split("/").pop() || "image").split("?")[0] || "image.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        console.warn(`[${extensionName}] 下载失败`, e);
        window.open(url, "_blank");
    }
}
