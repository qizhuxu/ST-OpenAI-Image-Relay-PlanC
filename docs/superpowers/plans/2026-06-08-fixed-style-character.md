# 风格·人物固定设定（Fixed Style & Character）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「世界书」tab 重构为「设定」tab——管理固定的**风格库**与**人物库**，并通过 `{{style}}`/`{{characters}}` 占位符注入优化模板，让优化 LLM 产出「风格 + 人物 + 场景/位置/动作」5 模块成品。

**Architecture:** 流水线新增 Step 0 `resolveFixedSettings(原文)`：默认子串匹配人物 + 用激活风格（0 LLM）；开了「LLM 自动选风格」或「LLM 智能识别人物」时合并为**一次**轻量分析调用产出「出场人物 + 风格」，再逐字查库取描述。固定资产经占位符注入优化模板；优化关闭 / 老模板无占位符 / 分析失败 → 退回现有「末尾拼 `【设定参考】` 块」。复用 `characterAppearance` 存储 key（零数据迁移）。

**Tech Stack:** 原生 ES module（无框架/无构建/无测试框架）；jQuery、`getContext()`（含 `generateRaw`/`loadWorldInfo`）、SillyTavern 全局；验证用一次性 Node `.mjs` 断言脚本。

---

## ⚠️ 执行前必读（本项目特例，覆盖技能默认）

1. **无测试框架**：本项目无 `package.json`/pytest/jest。"测试"= 把纯函数原样拷进一次性 `tmp_*.mjs` 脚本写断言、`node` 跑、跑完删。这是 spec §9 确认的方式，**不要**引入测试框架。ST 耦合函数（`callLlmForText`/`loadWorldInfo`/UI）只能浏览器内手测或用 stub 跑断言。
2. **提交受控**：用户当前在 `main` 上有**未提交的 WIP**（`index.js`/`manifest.json`/`settings_full.html`/`style.css`）。每个任务末尾的 `git commit` 是**逻辑检查点**——可 `git add`，但**实际 `git commit` 等用户放行后统一执行**（建议先与用户确认是否先建分支）。
3. **UI 双份同步铁律**：外部 `settings_full.html`（主用）与 index.js 内联 `SETTINGS_FULL_HTML` 常量必须一致（Task 9 改外部 HTML + index.js 的 JS，Task 10 重生成内联常量）。本期**无需改 `style.css`**（新控件复用 `.text_pole` / `.oair-btn-row` / `.oair-toggle-label`）。
4. **语言**：注释/UI/状态串一律中文。DOM id 前缀 `oair_`，class 前缀 `oair-`。
5. **函数声明可乱序**：新函数均为 `function`/`async function` 声明（模块作用域提升），插入位置不影响调用——下文给出推荐锚点，照做即可。
6. 关联 spec：`docs/superpowers/specs/2026-06-08-fixed-style-character-design.md`。

## 文件结构

| 文件 | 职责 | 改动 |
|---|---|---|
| `index.js` | 全部逻辑 + 内联 HTML + 绑定 | 设置 +5 key；重写 `DEFAULT_OPTIMIZE_TEMPLATE` + 新 `DEFAULT_ANALYSIS_TEMPLATE`；SECTION 14 +2 模板渲染函数；SECTION 15 +8 函数 + 重构 `injectStableDescriptions`；SECTION 7 改 `optimizePrompt`/`processPromptPipeline`；`manualOptimize`；UI 绑定/同步 + `populateStyleSelect` + 重置按钮；内联 `SETTINGS_FULL_HTML` 重生成 |
| `settings_full.html` | L2 浮窗 UI（外部主用） | tab 标签改名；`oair_panel_worldbook` 三段重写；「优化」tab 加重置按钮 |
| `CLAUDE.md` | 给后续 Claude 的指南 | 流水线（5 模块 + 注入优化模板）、设置、tab 列表（Task 11） |
| `manifest.json` | 版本号 | bump `1.9.0` → `1.10.0`（Task 11） |
| `tmp_*.mjs` | 一次性验证脚本 | 各任务内创建/运行/删除 |

**新增标识符（全程一致）**：
- 常量：`DEFAULT_ANALYSIS_TEMPLATE`（重写 `DEFAULT_OPTIMIZE_TEMPLATE`）
- 纯函数：`parseNamedLibrary` / `resolveStyleText` / `renderOptimizeTemplate` / `optimizeHasSlots` / `pickCappedText` / `appendFixedBlock` / `collectManualAppearancesByNames` / `parseAnalysisJson`
- 异步/编排：`analyzeSceneForFixed` / `gatherCharacterItems` / `resolveFixedSettings`（重构 `injectStableDescriptions` 为薄封装）
- UI 函数：`populateStyleSelect`
- 设置 key：`styleLibrary` / `styleActive` / `styleAutoSelect` / `characterLlmExtract` / `analysisTemplate`（复用 `characterAppearance`/`worldBook*`）
- DOM id：`oair_style_library` / `oair_style_active` / `oair_style_auto_select` / `oair_character_llm_extract` / `oair_btn_reset_optimize_template`

---

## Task 1: 设置 +5 key、重写优化模板、新增分析模板

**Files:**
- Modify: `index.js`（`DEFAULT_OPTIMIZE_TEMPLATE` 76-90；`defaultSettings` 153/159 处）

- [ ] **Step 1: 重写 `DEFAULT_OPTIMIZE_TEMPLATE`（5 模块 + 占位符）**

把第 76-90 行整个 `const DEFAULT_OPTIMIZE_TEMPLATE = [ ... ].join('\n');` 替换为：

```javascript
const DEFAULT_OPTIMIZE_TEMPLATE = [
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
].join('\n');
```

- [ ] **Step 2: 新增 `DEFAULT_ANALYSIS_TEMPLATE`**

在 Step 1 替换后的 `DEFAULT_OPTIMIZE_TEMPLATE` 闭合行 `].join('\n');` **之后**、`const DEFAULT_NSFW_TEMPLATE` **之前**插入：

```javascript

const DEFAULT_ANALYSIS_TEMPLATE = [
    '你是图片场景分析助手。阅读【场景原文】后判断两件事：',
    '1. characters：从【候选人物】里挑出本场景实际出场的人物名（数组；没有就空数组）。',
    '2. style：从【候选风格】里挑出最贴合本场景氛围的一个风格名（字符串；无合适就空字符串）。',
    '',
    '只输出一行紧凑 JSON，不要任何解释或代码块标记，例如：',
    '{"characters":["卡提希娅","齐齐"],"style":"写实"}',
    '',
    '【候选人物】：{{characters}}',
    '【候选风格】：{{styles}}',
    '【场景原文】：',
    '{{prompt}}',
].join('\n');
```

- [ ] **Step 3: 改 `characterAppearance` 注释 + 加 5 个设置 key**

把第 153 行：
```javascript
    characterAppearance: "",                       // 固定角色外貌注入：每行「名字：外貌」，生图时按出场角色自动并入（世界书未覆盖时的兜底）
```
改为：
```javascript
    characterAppearance: "",                       // 人物库：每行「名字：外貌」，出场角色的外貌逐字注入优化模板（世界书作补充来源）
```

在 `worldBookMaxChars: 800,`（第 159 行）**之后**插入：
```javascript

    // ─── 固定设定（风格库 / 人物库）─────────────────────────
    styleLibrary: "",                              // 风格库：每行「风格名：风格描述」
    styleActive: "",                               // 当前激活（默认固定）的风格名
    styleAutoSelect: false,                        // LLM 按场景自动选风格（覆盖 styleActive）
    characterLlmExtract: false,                    // LLM 智能识别出场人物（默认子串匹配）
    analysisTemplate: DEFAULT_ANALYSIS_TEMPLATE,   // 场景分析调用模板（出人物 + 选风格）
```

- [ ] **Step 4: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add style/character settings, rewrite optimize template, add analysis template"   # 待用户授权
```

---

## Task 2: `parseNamedLibrary` + `resolveStyleText`（纯函数）

**Files:**
- Modify: `index.js`（SECTION 15，紧贴 `async function injectStableDescriptions` 声明**上方**）
- Test: `tmp_lib_test.mjs`（临时）

- [ ] **Step 1: 实现两函数**

在 `async function injectStableDescriptions(prompt, settings) {`（约 2593 行）那一行**上方**插入：

```javascript
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
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_lib_test.mjs`（拷入两函数 + 断言）：

```javascript
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
function resolveStyleText(settings, styleName) {
    const want = String(styleName || "").trim();
    if (!want) return "";
    const lib = parseNamedLibrary(settings.styleLibrary);
    const exact = lib.find((s) => s.name === want);
    if (exact) return exact.body;
    const loose = lib.find((s) => s.name.includes(want) || want.includes(s.name));
    return loose ? loose.body : "";
}

let pass = 0, fail = 0;
const eqJson = (n, got, exp) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g === e) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${g}\n  exp: ${e}`); } };

// parseNamedLibrary
eqJson("parse-2", parseNamedLibrary("写实：电影级布光\n动漫：赛璐璐"),
    [{ name: "写实", body: "电影级布光", raw: "写实：电影级布光" }, { name: "动漫", body: "赛璐璐", raw: "动漫：赛璐璐" }]);
eqJson("parse-empty", parseNamedLibrary("  "), []);
eqJson("parse-skip-bad", parseNamedLibrary("没有冒号的一行\n写实：x"),
    [{ name: "写实", body: "x", raw: "写实：x" }]);
// resolveStyleText
eqJson("style-exact", resolveStyleText({ styleLibrary: "写实：电影级布光" }, "写实"), "电影级布光");
eqJson("style-empty-name", resolveStyleText({ styleLibrary: "写实：x" }, ""), "");
eqJson("style-not-found", resolveStyleText({ styleLibrary: "写实：x" }, "动漫"), "");
eqJson("style-loose", resolveStyleText({ styleLibrary: "写实风格：x" }, "写实"), "x");

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_lib_test.mjs`
Expected: 末行 `ALL PASS (pass=7, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_lib_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add parseNamedLibrary + resolveStyleText"   # 待用户授权
```

---

## Task 3: `renderOptimizeTemplate` + `optimizeHasSlots`（纯函数）

**Files:**
- Modify: `index.js`（SECTION 14，紧贴 `renderPromptWithMessage` 函数闭合 `}` **之后**，约 2286 行）
- Test: `tmp_render_test.mjs`（临时）

- [ ] **Step 1: 实现两函数**

在 `renderPromptWithMessage` 函数闭合 `}`（约 2286 行）**之后**插入：

```javascript
/**
 * 优化模板渲染：替换 {{style}}/{{characters}}/{{prompt}}；风格/人物为空时给中性兜底文案。
 */
function renderOptimizeTemplate(template, { prompt, style, characters } = {}) {
    const src = String(template || defaultSettings.optimizeTemplate);
    const styleText = String(style || "").trim() || "保持画面整体协调即可";
    const charText = String(characters || "").trim() || "（本图无需固定角色设定）";
    return src
        .replaceAll("{{style}}", styleText)
        .replaceAll("{{characters}}", charText)
        .replaceAll("{{prompt}}", String(prompt || "").trim());
}

/**
 * 模板是否含固定设定占位符（{{style}} 或 {{characters}}）。无则走旧的仅 {{prompt}} 渲染。
 */
function optimizeHasSlots(template) {
    return /\{\{\s*(style|characters)\s*\}\}/.test(String(template || ""));
}
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_render_test.mjs`：

```javascript
const defaultSettings = { optimizeTemplate: "" };   // stub：测试均显式传 template
function renderOptimizeTemplate(template, { prompt, style, characters } = {}) {
    const src = String(template || defaultSettings.optimizeTemplate);
    const styleText = String(style || "").trim() || "保持画面整体协调即可";
    const charText = String(characters || "").trim() || "（本图无需固定角色设定）";
    return src
        .replaceAll("{{style}}", styleText)
        .replaceAll("{{characters}}", charText)
        .replaceAll("{{prompt}}", String(prompt || "").trim());
}
function optimizeHasSlots(template) {
    return /\{\{\s*(style|characters)\s*\}\}/.test(String(template || ""));
}

let pass = 0, fail = 0;
const ok = (n, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${n}`); } };
const eq = (n, got, exp) => { if (got === exp) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${JSON.stringify(got)}\n  exp: ${JSON.stringify(exp)}`); } };

// optimizeHasSlots
ok("slot-style", optimizeHasSlots("a{{style}}b") === true);
ok("slot-chars-spaced", optimizeHasSlots("a{{ characters }}b") === true);
ok("slot-prompt-only", optimizeHasSlots("a{{prompt}}b") === false);
ok("slot-plain", optimizeHasSlots("纯文本") === false);
// renderOptimizeTemplate
eq("render-full", renderOptimizeTemplate("风格{{style}}人物{{characters}}场景{{prompt}}", { prompt: "P", style: "S", characters: "C" }), "风格S人物C场景P");
eq("render-empty-style", renderOptimizeTemplate("{{style}}", { prompt: "", style: "", characters: "" }), "保持画面整体协调即可");
eq("render-empty-chars", renderOptimizeTemplate("{{characters}}", {}), "（本图无需固定角色设定）");
eq("render-trim-prompt", renderOptimizeTemplate("{{prompt}}", { prompt: "  hi  " }), "hi");

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_render_test.mjs`
Expected: 末行 `ALL PASS (pass=8, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_render_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add renderOptimizeTemplate + optimizeHasSlots"   # 待用户授权
```

---

## Task 4: `pickCappedText` + `appendFixedBlock`（纯函数，降级拼接）

**Files:**
- Modify: `index.js`（SECTION 15，紧贴 `injectStableDescriptions` 声明**上方**）
- Test: `tmp_block_test.mjs`（临时）

- [ ] **Step 1: 实现两函数**

在 `async function injectStableDescriptions` 声明**上方**插入：

```javascript
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
    if (style) parts.push(`风格：${style}`);
    if (chars) parts.push(chars);
    if (!parts.length) return base;
    return `${base}\n\n【设定参考】\n${parts.join("\n")}`;
}
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_block_test.mjs`：

```javascript
function pickCappedText(items, maxChars) {
    const cap = Number(maxChars) || 800;
    const seen = new Set(); const picked = []; let total = 0;
    for (const item of (items || [])) {
        const t = String(item?.text || "").trim();
        if (!t || seen.has(t)) continue;
        if (total + t.length > cap) break;
        seen.add(t); picked.push(t); total += t.length;
    }
    return picked.join("\n");
}
function appendFixedBlock(prompt, fixed) {
    const base = String(prompt || ""); const parts = [];
    const style = String(fixed?.styleText || "").trim();
    const chars = String(fixed?.charactersText || "").trim();
    if (style) parts.push(`风格：${style}`);
    if (chars) parts.push(chars);
    if (!parts.length) return base;
    return `${base}\n\n【设定参考】\n${parts.join("\n")}`;
}

let pass = 0, fail = 0;
const eq = (n, got, exp) => { if (got === exp) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${JSON.stringify(got)}\n  exp: ${JSON.stringify(exp)}`); } };

// pickCappedText
eq("pick-dedupe", pickCappedText([{ text: "a" }, { text: "a" }, { text: "b" }], 800), "a\nb");
eq("pick-cap", pickCappedText([{ text: "金".repeat(5) }, { text: "银".repeat(5) }], 6), "金金金金金");
eq("pick-empty", pickCappedText([], 800), "");
// appendFixedBlock
eq("block-both", appendFixedBlock("P", { styleText: "写实", charactersText: "卡提希娅：金发" }), "P\n\n【设定参考】\n风格：写实\n卡提希娅：金发");
eq("block-style-only", appendFixedBlock("P", { styleText: "写实", charactersText: "" }), "P\n\n【设定参考】\n风格：写实");
eq("block-none", appendFixedBlock("P", { styleText: "", charactersText: "" }), "P");

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_block_test.mjs`
Expected: 末行 `ALL PASS (pass=6, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_block_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add pickCappedText + appendFixedBlock"   # 待用户授权
```

---

## Task 5: `collectManualAppearancesByNames`（按名取人物，LLM 路用）

**Files:**
- Modify: `index.js`（SECTION 15，紧贴 `injectStableDescriptions` 声明**上方**）
- Test: `tmp_bynames_test.mjs`（临时）

- [ ] **Step 1: 实现函数**

在 `async function injectStableDescriptions` 声明**上方**插入：

```javascript
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
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_bynames_test.mjs`：

```javascript
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
        if (names.some((n) => String(n).includes(name) || name.includes(String(n)))) out.push({ name, text: line });
    }
    return out;
}

let pass = 0, fail = 0;
const eqJson = (n, got, exp) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g === e) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${g}\n  exp: ${e}`); } };
const A = "卡提希娅：金发\n齐齐：黑发";

eqJson("hit", collectManualAppearancesByNames(A, ["卡提希娅"]), [{ name: "卡提希娅", text: "卡提希娅：金发" }]);
eqJson("loose-longer", collectManualAppearancesByNames(A, ["卡提希娅圣女"]), [{ name: "卡提希娅", text: "卡提希娅：金发" }]);
eqJson("covered", collectManualAppearancesByNames(A, ["卡提希娅"], new Set(["卡提希娅"])), []);
eqJson("empty-names", collectManualAppearancesByNames(A, []), []);

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_bynames_test.mjs`
Expected: 末行 `ALL PASS (pass=4, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_bynames_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add collectManualAppearancesByNames"   # 待用户授权
```

---

## Task 6: `parseAnalysisJson`（纯函数）+ `analyzeSceneForFixed`（LLM 包装）

**Files:**
- Modify: `index.js`（SECTION 15，紧贴 `injectStableDescriptions` 声明**上方**）
- Test: `tmp_analysis_test.mjs`（临时，仅测纯解析）

- [ ] **Step 1: 实现两函数**

在 `async function injectStableDescriptions` 声明**上方**插入：

```javascript
/**
 * 宽松解析分析调用返回：抽首个 {...} JSON 片段，归一成 {characters:string[], style:string}。
 * 解析失败 / 字段缺失 → 返回空结果（由上层降级）。
 */
function parseAnalysisJson(text) {
    const s = String(text || "");
    let obj = null;
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e) { obj = null; } }
    const characters = Array.isArray(obj?.characters)
        ? obj.characters.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
    const style = obj && obj.style != null ? String(obj.style).trim() : "";
    return { characters, style };
}

/**
 * 一次轻量分析调用：喂场景原文 + 候选人物名 + 候选风格名，要求输出紧凑 JSON。
 * 走 callLlmForText（主聊天模型 / 自定义文本后端），不经图片后端。失败由调用方兜回。
 */
async function analyzeSceneForFixed(prompt, { charNames = [], styleNames = [] } = {}) {
    const settings = extension_settings[extensionName];
    const template = settings.analysisTemplate || defaultSettings.analysisTemplate;
    const userMessage = String(template)
        .replaceAll("{{characters}}", charNames.join("、") || "（无）")
        .replaceAll("{{styles}}", styleNames.join("、") || "（无）")
        .replaceAll("{{prompt}}", String(prompt || "").trim());
    const systemPrompt = "你是一个图片场景分析助手，只输出 JSON。";
    const result = await callLlmForText(systemPrompt, userMessage);
    return parseAnalysisJson(result);
}
```

- [ ] **Step 2: 写验证脚本（仅纯解析 `parseAnalysisJson`）**

创建 `tmp_analysis_test.mjs`：

```javascript
function parseAnalysisJson(text) {
    const s = String(text || "");
    let obj = null;
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch (e) { obj = null; } }
    const characters = Array.isArray(obj?.characters) ? obj.characters.map((x) => String(x || "").trim()).filter(Boolean) : [];
    const style = obj && obj.style != null ? String(obj.style).trim() : "";
    return { characters, style };
}

let pass = 0, fail = 0;
const eqJson = (n, got, exp) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g === e) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${g}\n  exp: ${e}`); } };

eqJson("clean", parseAnalysisJson('{"characters":["A","B"],"style":"写实"}'), { characters: ["A", "B"], style: "写实" });
eqJson("surrounded", parseAnalysisJson('好的：{"characters":["A"],"style":"动漫"} 完成'), { characters: ["A"], style: "动漫" });
eqJson("malformed", parseAnalysisJson("not json"), { characters: [], style: "" });
eqJson("no-style", parseAnalysisJson('{"characters":["A"]}'), { characters: ["A"], style: "" });
eqJson("filter-blank", parseAnalysisJson('{"characters":["", " "],"style":""}'), { characters: [], style: "" });

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_analysis_test.mjs`
Expected: 末行 `ALL PASS (pass=5, fail=0)`

- [ ] **Step 4: 删除临时脚本 + 语法校验**

Run: `rm -f tmp_analysis_test.mjs && cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`
（`analyzeSceneForFixed` 用到 `callLlmForText`/`extension_settings`，只能浏览器手测，Task 11 覆盖。）

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add parseAnalysisJson + analyzeSceneForFixed"   # 待用户授权
```

---

## Task 7: `gatherCharacterItems` + `resolveFixedSettings` + 重构 `injectStableDescriptions`

**Files:**
- Modify: `index.js`（SECTION 15：新增两函数于 `injectStableDescriptions` 上方；替换 `injectStableDescriptions` 整个函数体 2593-2634）
- Test: `tmp_resolve_test.mjs`（临时，stub `loadActiveWorldBookEntries` / `analyzeSceneForFixed`）

- [ ] **Step 1: 新增 `gatherCharacterItems` + `resolveFixedSettings`**

在 `async function injectStableDescriptions` 声明**上方**插入：

```javascript
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

    if (settings.worldBookEnabled) {
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
    return collected;
}

/**
 * 流水线 Step 0：收集固定设定（风格 + 人物），返回 {styleText, charactersText}。
 * 两 LLM 开关都关 → 0 调用（子串匹配 + styleActive）；任一开 → 合并一次 analyzeSceneForFixed。
 * 分析失败静默降级：人物退子串、风格退 styleActive。
 */
async function resolveFixedSettings(prompt, settings) {
    const base = String(prompt || "");
    const needLlm = !!settings.characterLlmExtract || !!settings.styleAutoSelect;

    let analysis = null;
    if (needLlm) {
        try {
            const charNames = parseNamedLibrary(settings.characterAppearance).map((c) => c.name);
            const styleNames = parseNamedLibrary(settings.styleLibrary).map((s) => s.name);
            if (settings.worldBookEnabled) {
                try {
                    const entries = await loadActiveWorldBookEntries();
                    for (const e of entries) {
                        if (e.comment) charNames.push(e.comment);
                        charNames.push(...e.keys);
                    }
                } catch (e) { /* 世界书读不到不阻断分析 */ }
            }
            analysis = await analyzeSceneForFixed(base, { charNames: dedupeStrings(charNames), styleNames });
        } catch (err) {
            console.warn(`[${extensionName}] scene analysis failed, falling back`, err);
            analysis = null;
        }
    }

    const charNames = (settings.characterLlmExtract && analysis) ? analysis.characters : null;
    const styleName = (settings.styleAutoSelect && analysis && analysis.style)
        ? analysis.style
        : settings.styleActive;

    const items = await gatherCharacterItems(base, settings, charNames);
    const charactersText = pickCappedText(items, Number(settings.worldBookMaxChars) || 800);
    const styleText = resolveStyleText(settings, styleName);
    return { styleText, charactersText };
}
```

- [ ] **Step 2: 把 `injectStableDescriptions` 整个函数体（2593-2634）替换为薄封装**

```javascript
/**
 * 降级/总结路的固定设定注入：收集风格+人物 → 拼【设定参考】块到末尾。
 * 主流水线优化路改走 resolveFixedSettings + 优化模板占位符（见 processPromptPipeline）。
 */
async function injectStableDescriptions(prompt, settings) {
    return appendFixedBlock(prompt, await resolveFixedSettings(prompt, settings));
}
```

- [ ] **Step 3: 写验证脚本（stub `loadActiveWorldBookEntries`/`analyzeSceneForFixed`；真用其余纯函数）**

创建 `tmp_resolve_test.mjs`：

```javascript
const extensionName = "TEST";
function dedupeStrings(v) { return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))]; }
// 真实依赖（同源拷贝）
function extractEntrySection(content, headings) {
    const text = String(content || ""); if (!text.trim()) return ""; const MAX = 300;
    const heads = (Array.isArray(headings) ? headings : []).map((h) => String(h || "").trim().toLowerCase()).filter(Boolean);
    const lines = text.split(/\r?\n/);
    const lab = (line) => { const m = line.match(/^\s*([^\n：:]{1,16})\s*[:：]/); return m ? m[1].trim() : null; };
    for (let i = 0; i < lines.length; i++) {
        const label = lab(lines[i]);
        if (label && heads.includes(label.toLowerCase())) {
            const after = lines[i].replace(/^\s*[^\n：:]{1,16}\s*[:：]\s*/, "").trim();
            const buf = []; if (after) buf.push(after);
            for (let j = i + 1; j < lines.length; j++) { if (!lines[j].trim()) break; if (lab(lines[j])) break; buf.push(lines[j].trim()); }
            const body = buf.join(" ").trim(); if (body) return `${label}：${body}`.slice(0, MAX);
        }
    }
    return text.trim().slice(0, MAX);
}
function collectManualAppearances(prompt, appearanceText, covered = new Set()) {
    const base = String(prompt || ""); const raw = String(appearanceText || "").trim(); if (!raw) return [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); const out = []; let any = false;
    for (const line of lines) { const m = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/); if (m) { any = true; const name = m[1].trim(); if (covered.has(name)) continue; if (base.includes(name)) out.push({ name, text: line }); } }
    if (!any) out.push({ name: "", text: raw }); return out;
}
function collectManualAppearancesByNames(appearanceText, names, covered = new Set()) {
    const raw = String(appearanceText || "").trim(); if (!raw || !Array.isArray(names) || !names.length) return [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); const out = [];
    for (const line of lines) { const m = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/); if (!m) continue; const name = m[1].trim(); if (covered.has(name)) continue; if (names.some((n) => String(n).includes(name) || name.includes(String(n)))) out.push({ name, text: line }); }
    return out;
}
function parseNamedLibrary(text) {
    const raw = String(text || "").trim(); if (!raw) return []; const out = [];
    for (const line of raw.split(/\r?\n/)) { const t = line.trim(); if (!t) continue; const m = t.match(/^([^：:]{1,24})[：:]\s*(.+)$/); if (m) out.push({ name: m[1].trim(), body: m[2].trim(), raw: t }); }
    return out;
}
function resolveStyleText(settings, styleName) {
    const want = String(styleName || "").trim(); if (!want) return ""; const lib = parseNamedLibrary(settings.styleLibrary);
    const exact = lib.find((s) => s.name === want); if (exact) return exact.body;
    const loose = lib.find((s) => s.name.includes(want) || want.includes(s.name)); return loose ? loose.body : "";
}
function pickCappedText(items, maxChars) {
    const cap = Number(maxChars) || 800; const seen = new Set(); const picked = []; let total = 0;
    for (const item of (items || [])) { const t = String(item?.text || "").trim(); if (!t || seen.has(t)) continue; if (total + t.length > cap) break; seen.add(t); picked.push(t); total += t.length; }
    return picked.join("\n");
}
// stub 掉 ST 耦合
let _entries = [];
let analyzeCalls = 0;
let _analysis = { characters: [], style: "" };
let _throwAnalyze = false;
async function loadActiveWorldBookEntries() { return _entries; }
async function analyzeSceneForFixed() { analyzeCalls++; if (_throwAnalyze) throw new Error("boom"); return _analysis; }

// 被测函数（同源拷贝）
async function gatherCharacterItems(base, settings, names) {
    const collected = []; const covered = new Set(); const useNames = Array.isArray(names);
    const rel = (a, b) => { a = String(a); b = String(b); return a.includes(b) || b.includes(a); };
    if (settings.worldBookEnabled) {
        try {
            const entries = await loadActiveWorldBookEntries();
            const headings = String(settings.worldBookSectionHeadings || "").split(/[,，]/).map((h) => h.trim()).filter(Boolean);
            for (const e of entries) {
                let hit = null;
                if (useNames) hit = names.find((n) => e.keys.some((k) => rel(n, k)) || (e.comment && rel(n, e.comment)));
                else hit = e.keys.find((k) => base.includes(k));
                if (!hit) continue;
                const section = extractEntrySection(e.content, headings); if (!section) continue;
                collected.push({ name: e.comment || hit, text: section });
                e.keys.forEach((k) => covered.add(k)); if (e.comment) covered.add(e.comment);
            }
        } catch (err) { console.warn(err); }
    }
    if (useNames) collected.push(...collectManualAppearancesByNames(settings.characterAppearance, names, covered));
    else collected.push(...collectManualAppearances(base, settings.characterAppearance, covered));
    return collected;
}
async function resolveFixedSettings(prompt, settings) {
    const base = String(prompt || ""); const needLlm = !!settings.characterLlmExtract || !!settings.styleAutoSelect;
    let analysis = null;
    if (needLlm) {
        try {
            const charNames = parseNamedLibrary(settings.characterAppearance).map((c) => c.name);
            const styleNames = parseNamedLibrary(settings.styleLibrary).map((s) => s.name);
            if (settings.worldBookEnabled) { try { const entries = await loadActiveWorldBookEntries(); for (const e of entries) { if (e.comment) charNames.push(e.comment); charNames.push(...e.keys); } } catch (e) {} }
            analysis = await analyzeSceneForFixed(base, { charNames: dedupeStrings(charNames), styleNames });
        } catch (err) { console.warn(err); analysis = null; }
    }
    const charNames = (settings.characterLlmExtract && analysis) ? analysis.characters : null;
    const styleName = (settings.styleAutoSelect && analysis && analysis.style) ? analysis.style : settings.styleActive;
    const items = await gatherCharacterItems(base, settings, charNames);
    const charactersText = pickCappedText(items, Number(settings.worldBookMaxChars) || 800);
    const styleText = resolveStyleText(settings, styleName);
    return { styleText, charactersText };
}

let pass = 0, fail = 0;
const ok = (n, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${n}`); } };
const eq = (n, got, exp) => { if (got === exp) pass++; else { fail++; console.log(`FAIL ${n}\n  got: ${JSON.stringify(got)}\n  exp: ${JSON.stringify(exp)}`); } };
const S = (o) => ({ worldBookEnabled: false, worldBookSectionHeadings: "外貌", worldBookMaxChars: 800, characterAppearance: "", styleLibrary: "", styleActive: "", styleAutoSelect: false, characterLlmExtract: false, ...o });

(async () => {
    // 1) 无 LLM：子串匹配人物 + 激活风格；不调 analyze
    analyzeCalls = 0; _entries = [];
    let r = await resolveFixedSettings("卡提希娅微笑", S({ characterAppearance: "卡提希娅：金发蓝瞳\n齐齐：黑发", styleLibrary: "写实：电影布光", styleActive: "写实" }));
    eq("no-llm-chars", r.charactersText, "卡提希娅：金发蓝瞳");
    eq("no-llm-style", r.styleText, "电影布光");
    ok("no-llm-no-call", analyzeCalls === 0);

    // 2) 世界书命中（子串），手动同名被 covered 跳过
    _entries = [{ keys: ["卡提希娅"], content: "外貌：金发\n性格：高傲", comment: "卡提希娅" }];
    r = await resolveFixedSettings("卡提希娅", S({ worldBookEnabled: true, characterAppearance: "卡提希娅：手动描述", styleActive: "" }));
    eq("wb-hit", r.charactersText, "外貌：金发");
    eq("wb-no-style", r.styleText, "");

    // 3) LLM 识别人物：原文无名字也能按 analyze.characters 取库
    analyzeCalls = 0; _entries = []; _throwAnalyze = false; _analysis = { characters: ["齐齐"], style: "" };
    r = await resolveFixedSettings("他走了过来", S({ characterLlmExtract: true, characterAppearance: "齐齐：黑发青年\n卡提希娅：金发" }));
    eq("llm-chars", r.charactersText, "齐齐：黑发青年");
    ok("llm-called", analyzeCalls === 1);

    // 4) LLM 自动选风格：analyze.style 覆盖 styleActive
    _analysis = { characters: [], style: "动漫" };
    r = await resolveFixedSettings("x", S({ styleAutoSelect: true, styleLibrary: "写实：A\n动漫：B", styleActive: "写实" }));
    eq("llm-style", r.styleText, "B");

    // 5) analyze 抛错 → 降级：人物退子串、风格退 styleActive
    _throwAnalyze = true; _analysis = { characters: ["齐齐"], style: "动漫" };
    r = await resolveFixedSettings("卡提希娅在此", S({ characterLlmExtract: true, characterAppearance: "卡提希娅：金发", styleLibrary: "写实：A", styleActive: "写实" }));
    eq("degrade-chars", r.charactersText, "卡提希娅：金发");
    eq("degrade-style", r.styleText, "A");

    console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
})();
```

- [ ] **Step 4: 运行验证**

Run: `node tmp_resolve_test.mjs`
Expected: 末行 `ALL PASS (pass=10, fail=0)`

- [ ] **Step 5: 删除临时脚本 + 语法校验**

Run: `rm -f tmp_resolve_test.mjs && cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 6: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): add resolveFixedSettings + gatherCharacterItems, refactor injectStableDescriptions"   # 待用户授权
```

---

## Task 8: 改 `optimizePrompt` 签名 + 重排 `processPromptPipeline` + `manualOptimize`

**Files:**
- Modify: `index.js`（`optimizePrompt` 1350-1365；`processPromptPipeline` 1392-1412；`manualOptimize` ~1746）

- [ ] **Step 1: `optimizePrompt` 接 `fixed` 参数、按占位符分流**

把 `optimizePrompt`（1350-1365）整个函数替换为：

```javascript
async function optimizePrompt(prompt, fixed = null) {
    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) return prompt;

    const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
    const systemPrompt = "你是一个专业的图片提示词优化专家。";
    const userMessage = optimizeHasSlots(template)
        ? renderOptimizeTemplate(template, {
            prompt,
            style: fixed?.styleText,
            characters: fixed?.charactersText,
        })
        : renderPrompt(template, prompt);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] Prompt optimization failed, using original`, error);
        return prompt;
    }
}
```

- [ ] **Step 2: 重排 `processPromptPipeline`（Step0 收集 → Step1 优化/分流 → Step2 NSFW → Step3 降级拼接）**

把 `processPromptPipeline`（1392-1412）整个函数替换为：

```javascript
async function processPromptPipeline(prompt, options = {}) {
    const settings = extension_settings[extensionName];

    // Step 0: 收集固定设定（风格 + 人物）
    const fixed = await resolveFixedSettings(prompt, settings);

    // Step 1: 优化（启用且满足条件时）
    const shouldOptimize = options.forceOptimize || settings.optimizeAuto;
    const optimizeActive = settings.optimizeEnabled && shouldOptimize;
    let injected = false;
    if (optimizeActive) {
        setStatus("正在优化提示词...", "info");
        const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
        if (optimizeHasSlots(template)) {
            prompt = await optimizePrompt(prompt, fixed);   // 固定设定融进优化模板
            injected = true;
        } else {
            prompt = await optimizePrompt(prompt, null);     // 老模板无占位符 → 优化后再拼接
        }
    }

    // Step 2: NSFW 安全审查（如果启用）
    if (settings.nsfwAvoidance) {
        setStatus("正在安全审查...", "info");
        prompt = await sanitizePrompt(prompt);
    }

    // Step 3: 未注入到模板的固定设定 → 末尾拼【设定参考】块
    if (!injected) {
        prompt = appendFixedBlock(prompt, fixed);
    }

    return prompt;
}
```

- [ ] **Step 3: `manualOptimize` 预览也带固定设定**

把 `manualOptimize` 里（约 1746 行）：
```javascript
        const optimized = await optimizePrompt(prompt);
```
改为：
```javascript
        const fixed = await resolveFixedSettings(prompt, settings);
        const optimized = await optimizePrompt(prompt, fixed);
```
（`settings` 在该函数 1736 行已定义，可直接用。）

- [ ] **Step 4: 确认 `optimizePrompt(` 调用点无遗漏**

Run: `grep -n "optimizePrompt(" index.js`
Expected: 恰 3 处——定义行（`async function optimizePrompt`）、`processPromptPipeline` 内 2 处（`(prompt, fixed)` 与 `(prompt, null)`）、`manualOptimize` 内 1 处（`(prompt, fixed)`）。即 **4 行**（定义 1 + 调用 3）。若有未带第二参且非定义行的旧调用，补 `, null` 或对应 `fixed`。

- [ ] **Step 5: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 6: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(fixed): inject fixed settings into optimize template, reorder pipeline"   # 待用户授权
```

> 注：`summarizeAndGenerate`（1954 行）已调用 `await injectStableDescriptions(...)`，因其现为 `appendFixedBlock(resolveFixedSettings(...))` 的封装，**自动获得**风格+人物拼接行为，无需改动。

---

## Task 9: UI —「设定」tab 三段重写 + 重置按钮 + 绑定/同步（外部 HTML + index.js）

**Files:**
- Modify: `settings_full.html`（tab 标签 361；`oair_panel_worldbook` 627-652；「优化」tab 558 后）
- Modify: `index.js`（`bindSettingInput` ~822 后；`bindFloatingEvents` ~1041 后；新增 `populateStyleSelect`；`updateFloatingUi` ~1148 后）

- [ ] **Step 1: 改 tab 标签（settings_full.html 第 361 行）**

把：
```html
        <label for="oair_tab_worldbook" class="oair-tab-label">📖 世界书</label>
```
改为：
```html
        <label for="oair_tab_worldbook" class="oair-tab-label">🎭 设定</label>
```

- [ ] **Step 2: 重写 `oair_panel_worldbook` 面板（settings_full.html 627-652）**

把第 627-652 行整个 `<div class="oair-tab-panel" id="oair_panel_worldbook"> ... </div>` 替换为：

```html
    <div class="oair-tab-panel" id="oair_panel_worldbook">
        <!-- 风格库 -->
        <div class="oair-section">
            <div class="oair-section-title">风格库 <span class="oair-badge oair-badge-orange">固定·画风</span></div>
            <label class="oair-field-label">风格预设（每行一个，格式「风格名：风格描述」）</label>
            <textarea id="oair_style_library" class="text_pole" rows="4" style="width:100%; box-sizing:border-box;" placeholder="写实：写实摄影风格，电影级布光，高细节&#10;动漫：日式动漫赛璐璐风格，鲜艳色彩，干净线条"></textarea>
            <label class="oair-field-label">当前固定风格</label>
            <select id="oair_style_active" class="text_pole" style="width:100%; box-sizing:border-box;"></select>
            <label class="oair-toggle-label" style="margin-top:8px;">
                <input id="oair_style_auto_select" type="checkbox">
                由 LLM 按场景自动选风格（覆盖上面的固定选择）
            </label>
            <div class="oair-hint">不勾选时始终用「当前固定风格」，会话内一致；勾选后每次生图多一次轻量 LLM 分析挑风格。风格会注入优化模板的【风格】模块。</div>
        </div>

        <!-- 人物库 -->
        <div class="oair-section">
            <div class="oair-section-title">人物库 <span class="oair-badge oair-badge-green">固定·画对人</span></div>
            <label class="oair-field-label">角色外貌设定（每行一个角色，格式「名字：外貌描述」）</label>
            <textarea id="oair_character_appearance" class="text_pole" rows="5" style="width:100%; box-sizing:border-box;" placeholder="卡提希娅：金色长发，蓝色眼眸，尖耳，少女体型，前圣女气质，硬毛猪皮软甲，细带凉鞋，蓝色脚趾甲油&#10;齐齐：黑发青年，不死人，懒散的恶趣味神情"></textarea>
            <label class="oair-toggle-label" style="margin-top:8px;">
                <input id="oair_character_llm_extract" type="checkbox">
                由 LLM 智能识别出场人物（默认按名字匹配）
            </label>
            <div class="oair-hint">默认：名字在场景里出现就注入其外貌（0 额外调用）。勾选后用 LLM 识别出场人物（代词/别名也能认），与风格自动选合并为一次分析调用。出场角色外貌会逐字注入优化模板的【人物特征】模块。</div>
        </div>

        <!-- 自动来源：世界书 -->
        <div class="oair-section">
            <div class="oair-section-title">自动来源 · 世界书 <span class="oair-badge oair-badge-green">自动读设定</span></div>
            <label class="oair-toggle-label">
                <input id="oair_worldbook_enabled" type="checkbox">
                从世界书自动补充人物外貌 / 场景设定
            </label>
            <div class="oair-hint">
                开启后：人物库未写到的角色，会自动从「当前聊天 / 角色卡绑定的世界书」命中条目并取其相关段，作为人物库的补充来源。<br>
                世界书优先、人物库补未覆盖者。当前场景状态与动作仍由对话上下文决定。
            </div>
            <label class="oair-field-label">抽取的小节标题（逗号分隔，命中条目时只取这些段）</label>
            <input id="oair_worldbook_headings" class="text_pole" placeholder="外貌,长相,外观,appearance,场景,环境,setting,scene">
            <label class="oair-field-label">注入总字数上限</label>
            <input id="oair_worldbook_maxchars" class="text_pole" type="number" min="0" placeholder="800">
        </div>
    </div>
```

- [ ] **Step 3: 「优化」tab 加重置按钮（settings_full.html，第 558 行 `</details>` 之后）**

在「优化提示词模板」`</details>`（第 558 行）**之后**、`<!-- 自定义优化 LLM 后端 -->`（560 行）**之前**插入：

```html

            <div class="oair-btn-row">
                <button id="oair_btn_reset_optimize_template" class="menu_button" style="flex:1; justify-content:center;">↺ 重置为 5 模块新模板</button>
            </div>
            <div class="oair-hint">把优化模板重置为内置 5 模块版（含 {{style}} / {{characters}} / {{prompt}} 占位符）。老用户升级用；会覆盖当前模板内容。</div>
```

- [ ] **Step 4: `bindSettingInput` 区加 4 个绑定（index.js，第 822 行之后）**

在 `bindSettingInput("#oair_character_appearance", ...)`（第 822 行）**之后**插入：

```javascript
    bindSettingInput("#oair_style_library", "styleLibrary", () => fp.find("#oair_style_library").val());
    bindSettingInput("#oair_style_active", "styleActive", () => fp.find("#oair_style_active").val());
    bindSettingInput("#oair_style_auto_select", "styleAutoSelect", () => fp.find("#oair_style_auto_select").prop("checked"));
    bindSettingInput("#oair_character_llm_extract", "characterLlmExtract", () => fp.find("#oair_character_llm_extract").prop("checked"));
```

- [ ] **Step 5: `bindFloatingEvents` 加重置按钮 + 风格库变更重建下拉（index.js，第 1041 行 chatgpt2api 预设 handler 之后）**

在 `#oair_btn_chatgpt2api_preset` 的 `});`（第 1041 行）**之后**插入：

```javascript
    // 重置优化模板为 5 模块新模板
    fp.find("#oair_btn_reset_optimize_template").off("click").on("click", (e) => {
        e.preventDefault();
        const s = extension_settings[extensionName];
        s.optimizeTemplate = DEFAULT_OPTIMIZE_TEMPLATE;
        saveSettingsDebounced();
        fp.find("#oair_optimize_template").val(DEFAULT_OPTIMIZE_TEMPLATE);
        setStatus("已重置优化模板为 5 模块版", "success");
        toastr.success("优化模板已重置为内置 5 模块版（含 {{style}}/{{characters}} 占位符）。");
    });

    // 风格库内容变更 → 重建「当前固定风格」下拉
    fp.find("#oair_style_library").off("input.oair_style").on("input.oair_style", () => populateStyleSelect());
```

- [ ] **Step 6: 新增 `populateStyleSelect`（index.js，紧贴 `function updateFloatingUi` 声明上方）**

在 `function updateFloatingUi`（或 `updateFloatingUi` 的声明行）**上方**插入：

```javascript
/**
 * 用风格库的名字重建「当前固定风格」<select>，并回填已选 styleActive。
 * 用 jQuery .text/.val 写入，天然转义；空选项表示"不指定/自动"。
 */
function populateStyleSelect() {
    const fp = $("#oair_floating_panel");
    const sel = fp.find("#oair_style_active");
    if (!sel.length) return;
    const s = extension_settings[extensionName];
    const lib = parseNamedLibrary(s.styleLibrary);
    sel.empty();
    sel.append($("<option>").val("").text("（不指定 / 自动）"));
    for (const item of lib) {
        sel.append($("<option>").val(item.name).text(item.name));
    }
    sel.val(String(s.styleActive || ""));
}
```

- [ ] **Step 7: `updateFloatingUi` 值同步区加 4 行（index.js，第 1148 行 `oair_character_appearance` 之后）**

在 `fp.find("#oair_character_appearance").val(...)`（第 1148 行）**之后**插入：

```javascript
    fp.find("#oair_style_library").val(s.styleLibrary || "");
    fp.find("#oair_style_auto_select").prop("checked", !!s.styleAutoSelect);
    fp.find("#oair_character_llm_extract").prop("checked", !!s.characterLlmExtract);
    populateStyleSelect();   // 填充风格下拉并回填 styleActive
```

- [ ] **Step 8: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 9: 检查点（暂存；提交待授权）**

```bash
git add index.js settings_full.html
# git commit -m "feat(fixed): rebuild settings tab UI (style/character libraries) + reset button + bindings"   # 待用户授权
```

---

## Task 10: 同步内联 `SETTINGS_FULL_HTML` 常量（铁律：双份一致）

**Files:**
- Modify: `index.js`（内联 `SETTINGS_FULL_HTML` 常量，第 181 行那一长行）
- 工具: `tmp_regen.mjs`（临时）

- [ ] **Step 1: 写重生成脚本**

创建 `tmp_regen.mjs`（读更新后的 `settings_full.html` → 生成 JS 字符串字面量、非 ASCII 转 `\uXXXX` → 替换 index.js 里的常量行）：

```javascript
import fs from "node:fs";
const html = fs.readFileSync("settings_full.html", "utf8");
let lit = JSON.stringify(html);
let esc = "";
for (const ch of lit) {
    const code = ch.codePointAt(0);
    esc += code > 127 ? "\\u" + code.toString(16).padStart(4, "0") : ch;
}
const newConst = "const SETTINGS_FULL_HTML = " + esc + ";";

let js = fs.readFileSync("index.js", "utf8");
const re = /const SETTINGS_FULL_HTML = "(?:[^"\\]|\\.)*";/;
if (!re.test(js)) { console.error("ERROR: 未找到 SETTINGS_FULL_HTML 常量行"); process.exit(1); }
js = js.replace(re, newConst);
fs.writeFileSync("index.js", js);
console.log("REGEN OK, const length =", newConst.length);
```

- [ ] **Step 2: 运行重生成**

Run: `node tmp_regen.mjs`
Expected: 打印 `REGEN OK, const length = <数字>`（非 ERROR）

- [ ] **Step 3: 校验内联常量含新内容 + 语法**

Run: `grep -c "由 LLM 智能识别出场人物" index.js`
Expected: `1`（该文案只在内联 HTML 出现，JS 里没有）

Run: `grep -c "🎭 设定" index.js`
Expected: `1`

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_regen.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "chore(fixed): regenerate inline SETTINGS_FULL_HTML"   # 待用户授权
```

---

## Task 11: 收尾 — manifest 版本、CLAUDE.md、浏览器手测

**Files:**
- Modify: `manifest.json`（`version`）
- Modify: `CLAUDE.md`（流水线 / 设置 / tab 列表）

- [ ] **Step 1: bump manifest 版本**

把 `manifest.json` 的 `"version": "1.9.0"` 改为 `"version": "1.10.0"`。

- [ ] **Step 2: 更新 CLAUDE.md**

- 「Core data flow」Step 3：把"optional LLM optimize → optional NSFW → injectStableDescriptions"改述为：**Step 0 `resolveFixedSettings`**（子串匹配/按需一次 `analyzeSceneForFixed` 分析 → 逐字查库取风格+人物）→ 优化（模板含 `{{style}}/{{characters}}` 占位符时由 `optimizePrompt(prompt, fixed)` 注入；否则 `appendFixedBlock` 退化）→ NSFW → 未注入则末尾 `appendFixedBlock`。
- 「Settings」：补 `styleLibrary` / `styleActive` / `styleAutoSelect` / `characterLlmExtract` / `analysisTemplate`；说明 `characterAppearance` 现为「人物库」、`DEFAULT_OPTIMIZE_TEMPLATE` 现含 `{{style}}/{{characters}}` 占位符（`renderOptimizeTemplate`/`optimizeHasSlots`）。
- 「The three-layer Hybrid UI」7 tab 列表：把「世界书」改为「设定」（内部 panel id 仍 `oair_panel_worldbook`）。
- 「Conventions & gotchas」补一条：固定设定（风格/人物）默认走优化模板占位符注入；优化关闭 / 老模板无占位符 / 分析失败 → `appendFixedBlock` 末尾拼接降级。

- [ ] **Step 3: 浏览器内手测（人工，必须）**

1. 同步本目录到 `SillyTavern/public/scripts/extensions/third-party/<folder>/`，硬刷新。
2. L2 浮窗「🎭 设定」tab：
   - 风格库填 `写实：写实摄影，电影级布光` 与 `动漫：日式赛璐璐`；「当前固定风格」下拉应出现这两项 + “（不指定/自动）”，选「写实」。
   - 人物库填 `卡提希娅：金色长发，蓝色眼眸`。
3. 「✨ 优化」tab：点「↺ 重置为 5 模块新模板」→ 模板文本框应变为含 `{{style}}/{{characters}}/{{prompt}}` 的新模板；勾选「启用提示词优化」+「自动优化」。
4. **占位符注入路**：触发一次生图（自动 `<pic>` / 手动 / 消息按钮）。DevTools 控制台 `[ST-OpenAI-Image-Relay]` 无报错；发往图片后端的提示词应是融合了「写实」风格与「卡提希娅」逐字外貌的成品（可在 `requestImagesFromBackend` 前 `console.log` 或看网络请求体）。
5. **LLM 自动选风格**：勾「由 LLM 按场景自动选风格」→ 再生图，控制台应多一次文本 LLM 调用（分析），风格随场景变化。
6. **LLM 识别人物**：人物库留「卡提希娅」，原文只用代词（如"她微笑"），勾「由 LLM 智能识别出场人物」→ 应仍注入卡提希娅外貌。
7. **降级路**：关闭「启用提示词优化」→ 再生图，提示词末尾应出现 `【设定参考】\n风格：…\n卡提希娅：…`。
8. **老模板兜底**：把优化模板手动删成只含 `{{prompt}}`（无占位符），开优化 → 应优化后再末尾拼 `【设定参考】`（不报错、不丢设定）。
9. **世界书来源**：给聊天绑一本世界书、建「卡提希娅」条目含 `外貌：…`，人物库清空该角色，开「自动来源·世界书」→ 应从世界书取外貌。

- [ ] **Step 4: 检查点（暂存；提交待授权）**

```bash
git add manifest.json CLAUDE.md
# git commit -m "docs(fixed): bump version to 1.10.0, update CLAUDE.md"   # 待用户授权
```

---

## 自检（Self-Review）

**Spec 覆盖**：
- §3.1 设置 +5 key（复用 `characterAppearance`/`worldBook*`）→ Task 1 ✓
- §3.2 重写优化模板（5 模块 + `{{style}}`/`{{characters}}`）→ Task 1 ✓
- §3.3 `renderOptimizeTemplate`/`optimizeHasSlots` → Task 3；`resolveFixedSettings`/`appendFixedBlock`/`optimizePrompt` 改签名 → Task 4/7/8；`injectStableDescriptions` 拆分薄封装 → Task 7；`parseNamedLibrary` → Task 2；`analyzeSceneForFixed` → Task 6 ✓
- §3.4 流水线 Step0→1→2→3 + `summarizeAndGenerate`（自动获益）+ `CHAT_CHANGED`（不变）→ Task 8 ✓
- §4 数据流（子串/LLM 双路、风格 active/auto、封顶）→ Task 7（逻辑）+ tmp_resolve_test 5 场景 ✓
- §5 分析调用（触发条件、宽松 JSON 解析、降级、逐字查库）→ Task 6/7 ✓
- §6 UI（设定 tab 三段、tab 改名保 id、重置按钮、`<select>` 重建、三处绑定）→ Task 9 + 10 ✓
- §7 兼容/迁移/降级（`characterAppearance` 零迁移、老模板退化、优化关、分析失败）→ Task 1/7/8 + tmp_resolve_test degrade ✓
- §8 不做 thinking 开关 → 全程不涉及 ✓
- §9 验证（Node 断言 + node --check + 浏览器手测）→ 各任务 ✓
- §10 涉及文件（含 manifest/CLAUDE.md；本期不动 style.css）→ Task 1-11 全覆盖 ✓

**占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码、每个验证步骤含可跑命令与预期输出。✓

**类型/命名一致性**：`resolveFixedSettings(prompt, settings)→{styleText,charactersText}`、`gatherCharacterItems(base,settings,names)`、`appendFixedBlock(prompt,{styleText,charactersText})`、`renderOptimizeTemplate(template,{prompt,style,characters})`、`optimizeHasSlots(template)`、`pickCappedText(items,maxChars)`、`parseNamedLibrary→{name,body,raw}`、`resolveStyleText(settings,styleName)`、`collectManualAppearancesByNames(appearanceText,names,covered)`、`parseAnalysisJson→{characters,style}`、`analyzeSceneForFixed(prompt,{charNames,styleNames})`、`populateStyleSelect()`、设置 key、DOM id —— 跨 Task 1-11 拼写一致。✓
- 注意：分析模板里 `{{characters}}`=候选人物名单、`{{styles}}`=候选风格名单；优化模板里 `{{characters}}`=人物外貌描述、`{{style}}`=风格描述。**两套模板不同变量含义**，分别由 `analyzeSceneForFixed` 与 `renderOptimizeTemplate` 渲染，无串用。✓

**已知偏差（有意）**：strict 失败优先 TDD 不适用（无 runner），改用"实现→拷入 tmp 脚本断言→跑绿"；`analyzeSceneForFixed`/`gatherCharacterItems` 的 ST 耦合部分用 stub 跑断言 + 浏览器手测；commit 步骤受用户授权门控（用户当前 main 有 WIP）。
