# 风格·人物固定设定重构（Fixed Style & Character）设计文档

- 日期：2026-06-08
- 状态：设计已确认（方案 A），待写实现计划
- 关联扩展：ST-OpenAI-Image-Relay（SillyTavern 第三方扩展）
- 取代/重构：`2026-06-07-worldbook-injection`（世界书注入）的「固定角色外貌（兜底）」定位 + 「世界书」tab 形态

## 1. 背景与动机

一张生图提示词可拆成 **5 个模块**：

| 模块 | 性质 | 来源 | 谁负责 |
|---|---|---|---|
| ① 风格 | 固定、可复用 | 预定义风格库 | 本设计（注入优化模板） |
| ② 人物特征（外貌） | 固定、可复用 | 人物库 / 世界书 | 本设计（注入优化模板） |
| ③ 场景环境 | 每张图都在变 | 对话上下文 | 优化 LLM 从原文提炼 |
| ④ 人物空间位置 | 动态 | 对话上下文 | 优化 LLM 从原文提炼 |
| ⑤ 行为动作 | 纯动态 | 对话上下文 | 优化 LLM 从原文提炼 |

其中 **①风格、②人物 是「固定资产」**——应来自用户维护的库，而不是每次从消息里临时改写；③④⑤ 是动态的，由优化 LLM 从本次场景原文提炼。

当前实现里，固定设定（`characterAppearance` 兜底 + 世界书命中）是在流水线 **Step 3** 以 `【设定参考】` 块**拼到提示词末尾**，并不进入优化模板——优化 LLM 看不到固定外貌，无法把它自然融进画面描述。本设计把固定的「风格 + 人物」**注入优化模板**，让优化 LLM 以它们为锚点产出 5 模块成品。

## 2. 目标 / 非目标

**目标**
- 把「世界书」tab 重构为「设定」tab，管理两个固定资产库：**风格库** + **人物库**。
- 风格：库 + 手动选定一个为默认（会话内固定）+ 可选「LLM 按场景自动选风格」开关。
- 人物：默认子串匹配出场人物（0 额外 LLM 调用）+ 可选「LLM 智能识别人物」开关。
- 任一 LLM 开关开启时，**合并为一次**轻量分析调用，同时产出「出场人物 + 选定风格」。
- 固定的风格、人物以 `{{style}}` / `{{characters}}` 占位符**注入优化模板**；优化 LLM 负责 ③④⑤。
- 人物描述**逐字**注入（程序化查库取原文），保证「画对人」的一致性。
- 全程优雅降级：优化关闭 / 老模板无占位符 / 分析调用失败 → 退回现有「末尾拼 `【设定参考】` 块」。
- 零数据迁移：复用 `characterAppearance` 存储 key，老用户数据自动呈现在新人物库。

**非目标（本期不做）**
- 不为 `generateRaw` 增加 thinking/reasoning 开关（见 §8）。
- 不改世界书读取的内部逻辑（`loadActiveWorldBookEntries` / `extractEntrySection` 原样复用），仅重新定位为「人物库的自动来源」。
- 风格不做"每条消息逐图不同"以外的高级语义（无风格权重/混合/LoRA 概念）。
- 不引入结构化输出工具调用（`generateRaw` 无 tool calling）；分析调用用「输出紧凑 JSON + 宽松解析」实现。

## 3. 架构

### 3.1 设置（SECTION 2 `defaultSettings`）

**新增 key**

| key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `styleLibrary` | string | `""` | 风格库，多行「风格名：风格描述」 |
| `styleActive` | string | `""` | 当前激活（默认固定）的风格名 |
| `styleAutoSelect` | bool | `false` | 「LLM 按场景自动选风格」开关 |
| `characterLlmExtract` | bool | `false` | 「LLM 智能识别人物」开关 |
| `analysisTemplate` | string | `DEFAULT_ANALYSIS_TEMPLATE` | 分析调用模板 |

**复用（不改 key，零迁移）**
- `characterAppearance` —— 存储 key 不动；UI 改叫「人物库」、删除"兜底"措辞。老用户数据自动流入。
- `worldBookEnabled` / `worldBookSectionHeadings` / `worldBookMaxChars` —— 功能与内部逻辑不变，UI 重新定位为「人物库的自动来源」。
- `optimizeEnabled` / `optimizeAuto` / `optimizeTemplate` —— 不变；模板内容重写见 §3.2。

> ⚠️ `ensureSettings()` 合并方向是「已存值覆盖默认值」。改默认常量对老用户不生效：所以 (a) 老优化模板需运行时检测占位符并降级；(b) 提供「重置为新模板」按钮主动升级。

### 3.2 新优化模板（重写 `DEFAULT_OPTIMIZE_TEMPLATE`，5 模块 + 占位符）

新增 `{{style}}`、`{{characters}}` 两个占位符（`{{prompt}}` 保留）。结构示意：

```
你是专业的图片提示词优化专家。请把下列信息整合成一段可直接生成【单张】图片的中文提示词。

【风格】（固定，必须严格遵循）：
{{style}}

【人物特征】（固定，出现的角色必须逐字保留以下外貌设定，不得改写或省略）：
{{characters}}

【本次场景原文】：
{{prompt}}

整合要求：
1. 从场景原文中提炼〔场景环境〕〔人物空间位置〕〔行为动作〕三部分。
2. 若原文含多个场景，只取最后出现 / 最具视觉冲击力的高潮场景。
3. 出现的具名角色必须套用上面【人物特征】的固定外貌，严禁替换成「女孩」「男子」等泛称。
4. 不要虚构未提供的人物或设定；可补构图/视角/光线等利于出图的细节，但不得削弱已有关键信息。
5. 用中文连贯句子，只输出最终提示词，不要任何解释、前言或后记。
```

`DEFAULT_NSFW_TEMPLATE`、`DEFAULT_SUMMARIZE_TEMPLATE` 不变。

### 3.3 新增 / 改动函数（SECTION 7 流水线 + SECTION 15 设定注入）

- `renderOptimizeTemplate(template, { prompt, style, characters }): string` **（新）**
  替换 `{{prompt}}` / `{{style}}` / `{{characters}}`。空值兜底：`style` 空 → `"保持画面整体协调即可"`；`characters` 空 → `"（本图无需固定角色设定）"`。

- `async resolveFixedSettings(prompt, settings): Promise<{ styleText, charactersText }>` **（新，Step 0 收集器）**
  见 §5。只负责「收集固定资产」，不负责拼接 / 注入。

- `appendFixedBlock(prompt, { styleText, charactersText }): string` **（新，降级路径）**
  把固定资产拼成 `【设定参考】` 块追加到 `prompt` 末尾（沿用现 `injectStableDescriptions` 尾部的去重/格式风格；风格也并入此块）。

- `optimizePrompt(prompt, fixed)` **（改签名）**
  原只吃 `prompt`；现额外接 `fixed`。模板含占位符 → 用 `renderOptimizeTemplate` 注入；否则走旧 `renderPrompt`（仅 `{{prompt}}`）。

- `injectStableDescriptions(prompt, settings)` **（重构拆分）**
  原「收集 + 拼接」二合一拆成 `resolveFixedSettings`（收集）+ `appendFixedBlock`（拼接）。本函数本身可保留为「`appendFixedBlock(prompt, await resolveFixedSettings(...))`」的薄封装，供降级路径与 `summarizeAndGenerate` 复用。

- `parseNamedLibrary(text): Array<{ name, body, raw }>` **（新，小工具）**
  解析「名字：描述」多行文本（风格库 / 人物库共用），供风格 `<select>` 填充与查库。

- `async analyzeSceneForFixed(prompt, { charNames, styleNames }, settings): Promise<{ characters: string[], style: string }>` **（新，仅在需 LLM 时调用）**
  见 §5。`callLlmForText` + 宽松 JSON 解析；失败抛错由 `resolveFixedSettings` 兜回子串/激活风格。

### 3.4 接入流水线（`processPromptPipeline`）

```
Step0（新）fixed = await resolveFixedSettings(prompt, settings)      // {styleText, charactersText}
Step1 优化：
   const slots = optimizeEnabled && shouldOptimize
   if (slots && 模板含占位符)        prompt = await optimizePrompt(prompt, fixed)   // 融进 5 模块；injected=true
   else if (slots)                    prompt = await optimizePrompt(prompt, null)    // 旧模板无占位符；injected=false
   else                               injected=false                                  // 优化关，不调 LLM
Step2 NSFW 审查（不变）
Step3 if (!injected)               prompt = appendFixedBlock(prompt, fixed)          // 退化路径
```

- `summarizeAndGenerate`（绕过 `processPromptPipeline`）：`summarize → sanitize → appendFixedBlock(resolveFixedSettings(...))`，保持与主流水线一致。
- `manualGenerate` 走 `processPromptPipeline`，自动获得同一行为。
- `CHAT_CHANGED` 仍清 `worldBookCache`（不变）。

## 4. 数据流

```
processPromptPipeline(prompt):
  Step0 resolveFixedSettings(prompt, settings)
        ├─ 人物：
        │    两开关都关 → 子串匹配（人物库名 + 世界书 key ⊂ prompt）→ 逐字描述
        │    任一开关开 → analyzeSceneForFixed() 一次调用 → {characters[], style}
        │                  → 按名查库取逐字描述（世界书优先，人物库补，worldBookMaxChars 封顶）
        └─ 风格：
             styleAutoSelect 关 → styleActive
             styleAutoSelect 开 → analyze 返回的 style
             → parseNamedLibrary(styleLibrary) 按名取风格描述
        ⇒ { styleText, charactersText }
  Step1 优化（开 且 模板含占位符）→ renderOptimizeTemplate({prompt, style, characters}) → callLlmForText
        否则不注入（injected=false）
  Step2 sanitize（可选）
  Step3 injected? 跳过 : appendFixedBlock(prompt, {styleText, charactersText})
  → requestImagesFromBackend(prompt)
```

## 5. 分析调用（`resolveFixedSettings` 内部）

**触发**：`characterLlmExtract || styleAutoSelect` 为真才调用 `analyzeSceneForFixed`；否则 0 LLM 调用。

**输入**（喂给 `analysisTemplate`）：本次场景原文 + 候选人物名单（`parseNamedLibrary(characterAppearance)` 的名字 ∪ 世界书 entry 的 `comment`/`key`）+ 候选风格名单（`parseNamedLibrary(styleLibrary)` 的名字）。

**输出**：要求模型输出紧凑 JSON，例如 `{"characters":["卡提希娅","齐齐"],"style":"写实"}`。
- 宽松解析：取首个 `{...}` 片段 `JSON.parse`；失败再用正则兜底抽 `characters`/`style`。
- 只用需要的字段：`characterLlmExtract` 开 → 用 `characters`，否则仍走子串匹配；`styleAutoSelect` 开 → 用 `style`，否则用 `styleActive`。
- 任意失败（无响应 / 解析失败 / 名字查库为空）→ 静默降级：人物退子串匹配，风格退 `styleActive`，并 `console.warn`。

**逐字描述查找**：拿到名字后，先在世界书条目里找（名字与 `key`/`comment` 互相子串即命中）→ `extractEntrySection` 取相关段并记 `covered`；`covered` 之外的名字再用 `parseNamedLibrary(characterAppearance)` 补；去重、累计到 `worldBookMaxChars` 封顶。复用现有 `loadActiveWorldBookEntries` / `extractEntrySection` / `collectManualAppearances` 思路。

**关于"轻量"**：分析调用是短输入短输出的抽取任务，不需要 thinking；这正契合 §8 观察到的「无 reasoning 也够用」，反而更快更省。

## 6. UI 改动（`settings_full.html` + 内联 `SETTINGS_FULL_HTML` + `style.css` 三处同步）

> ⚠️ 项目铁律：UI 三份同步——外部 `settings_full.html`、index.js 内联 `SETTINGS_FULL_HTML`、`style.css` 与内联 `<style>`。DOM id 前缀 `oair_`、class 前缀 `oair-`、文案中文。

- **tab 标签**：`📖 世界书` → **`🎭 设定`**。
  **内部 id 保持 `oair_tab_worldbook` / `oair_panel_worldbook` 不变**——避免改 CSS `:checked ~` 选择器两组 + 两处 `tabMap`（`loadFullSettings`、`toggleFloatingPanel`），降风险。
- **panel 内三段**（替换原「世界书注入」+「固定角色外貌（兜底）」两段）：
  1. **风格库**：`#oair_style_library`（textarea，「风格名：描述」）+ `#oair_style_active`（`<select>`，由 `parseNamedLibrary(styleLibrary)` 填充，textarea 变更与加载时重建）+ `#oair_style_auto_select`（开关）。
  2. **人物库**：复用 `#oair_character_appearance`（textarea，改文案、去"兜底"）+ `#oair_character_llm_extract`（开关）。
  3. **自动来源 · 世界书**：现有 `#oair_worldbook_enabled` / `#oair_worldbook_headings` / `#oair_worldbook_maxchars` 原样搬入，文案重定位为"从世界书自动补充人物外貌/场景设定"。
- **「优化」tab**：加 `#oair_btn_reset_optimize_template`「重置为 5 模块新模板」按钮（写回 `DEFAULT_OPTIMIZE_TEMPLATE`）。
- **绑定点**：`bindFloatingEvents`（按钮 + `<select>` 重建钩子）、`bindSettingInput`（新 key）、`updateFloatingUi`/`load`（回填新控件 + 填充 `<select>`）三处补齐。

## 7. 兼容 / 迁移 / 降级

- `characterAppearance` key 不动 → 老人物数据自动出现在「人物库」。
- 老优化模板（无 `{{style}}`/`{{characters}}`）→ 运行时检测占位符缺失 → 走 `appendFixedBlock` 退化（功能不丢）；「重置为新模板」按钮主动升级。
- 优化关闭 → 末尾拼 `【设定参考】` 块（含风格）。
- 分析调用失败 / 老 ST 无世界书 API → 人物退子串、风格退 `styleActive`，静默 `console.warn`。
- 风格库 / 激活风格留空 → `{{style}}` 走空值兜底；不影响出图。

## 8. 关于「好像没请求思考」

会话日志里观察到优化调用返回 `reasoning_content: null`（主模型未做可见思考），但成品质量已足够。`generateRaw` 不单独暴露 thinking 开关，且：
- 优化任务在无 thinking 下质量达标；
- 新增的分析调用是轻量抽取，**本就不应**开 thinking（省 token、避免 §当前观察到的"思考吃光预算→截断"风险）。

故本期**不做 thinking 开关**。如后续确需，再单列设计。

## 9. 验证方式（项目无测试框架）

- **纯逻辑**（`parseNamedLibrary`、`renderOptimizeTemplate` 占位符与空值兜底、分析 JSON 宽松解析、`appendFixedBlock` 去重/封顶、子串匹配路径）→ 沿用 Node `tmp_*.mjs` 脚本：把纯函数拷出跑断言，跑完即删。
- **ST 耦合部分**（`resolveFixedSettings` 接世界书、analyze 走 `callLlmForText`、`<select>` 重建、tab 文案、重置按钮、三入口端到端）→ 复制扩展到 `third-party/`、浏览器手测，看 DevTools `[ST-OpenAI-Image-Relay]` 日志。
- 改完 `node --check`（按 `.mjs` 解析）做语法校验；三处 UI 副本一致性人工核对。

## 10. 涉及文件

- `index.js`：`defaultSettings`（+5 key）、`DEFAULT_OPTIMIZE_TEMPLATE` 重写 + 新 `DEFAULT_ANALYSIS_TEMPLATE`、SECTION 7（`processPromptPipeline` 重排、`optimizePrompt` 改签名、新 `renderOptimizeTemplate`）、SECTION 15（`resolveFixedSettings` / `appendFixedBlock` / `analyzeSceneForFixed` / `parseNamedLibrary`，重构 `injectStableDescriptions`）、`summarizeAndGenerate`、`SETTINGS_FULL_HTML` 内联常量、`bindFloatingEvents`/`bindSettingInput`/`updateFloatingUi`、重置模板按钮处理器。
- `settings_full.html`：「设定」tab 三段重写 + 「优化」tab 重置按钮。
- `style.css` / 内联 `<style>`：新控件样式（如 `<select>` 行、库 textarea）。
- `CLAUDE.md`：实现后更新流水线说明（5 模块 + 注入优化模板）、设置说明（新 key）、tab 列表（设定）。
- `manifest.json`：版本 bump（`1.9.0` → `1.10.0`）。

## 11. 未来可扩展（明确排除在本期外）

- 风格混合 / 权重 / 负面提示词独立模块。
- 人物库可视化编辑（卡片式）替代纯文本「名字：描述」。
- 分析调用结果缓存（同一消息多次生图复用），减少重复 LLM 调用。
- 把 ③④⑤ 也模块化为可独立编辑/调试的子模板。
