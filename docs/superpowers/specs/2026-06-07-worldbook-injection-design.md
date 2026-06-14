# 世界书注入（World Book Injection）设计文档

- 日期：2026-06-07
- 状态：设计已确认，待写实现计划
- 关联扩展：ST-OpenAI-Image-Relay（SillyTavern 第三方扩展）
- 关联既有特性：本会话新增的 `injectCharacterAppearance` / `settings.characterAppearance`（手动固定角色外貌）

## 1. 背景与动机

生图提示词的质量可拆成三个维度：**人物（谁）+ 场景（哪）+ 行为（在干嘛）**。各维度的"信息来源"不同：

| 维度 | 性质 | 来源 | 机制 |
|---|---|---|---|
| 人物外貌 | 稳定、可复用 | 世界书 | 具名实体注入（本设计） |
| 固定场景设定（地点的标志性环境） | 稳定、可复用 | 世界书 | 具名实体注入（同一套） |
| 当前场景状态（此刻雨夜/烛光/桌上摊着信） | 每张图都在变 | 对话上下文 | 主提示词 + 优化模板 |
| 行为/动作 | 纯动态、不可预存 | 对话上下文 | 主提示词 + 优化模板 |

当前 `injectCharacterAppearance` 已能注入**手动填写**的固定角色外貌，但需要用户在插件里另填一遍、与世界书两头维护。SillyTavern 的世界书里通常已经写好了人物外貌、地点设定，**可以直接读取复用**。

本设计：把"具名实体的稳定描述"统一从世界书读取（人物外貌 + 固定场景设定），手动文本框降级为兜底；动态的场景状态与行为仍由上下文（主提示词 + 优化）负责，不在本设计范围。

## 2. 目标 / 非目标

**目标**
- 从当前激活的世界书读取条目，按 `key` 关键词命中生图提示词时，注入该条目的**相关段**（人物的外貌段、地点的场景/环境段）。
- 同时覆盖**人物**与**地点/场景**条目（同一套"具名实体注入"机制）。
- 与手动 `characterAppearance` 的关系为**世界书优先、手动兜底**（世界书未覆盖的角色才用手动）。
- 只取相关段，控制注入长度，避免把性格/剧情等非视觉噪声塞进提示词。
- 全程优雅降级：任何一步失败都静默退回手动兜底，不影响既有流水线。
- 跨 ST 版本安全：老版本无世界书 API 时自动关闭该路。

**非目标（本期不做）**
- 不复刻 SillyTavern 世界书的高级激活语义（递归扫描、二级关键词 AND/NOT、预算/深度、sticky/cooldown）。本期用朴素关键词子串匹配。
- 不处理"当前场景状态"和"行为/动作"——这两者属于上下文，由现有主提示词指令 + 优化模板负责（本会话已强化）。
- 不接入 `getWorldInfoPrompt` 扫描器（曾作为"场景路 B 方案"，因输出是为主提示词拼好的不透明整块文本、无法抽段/按条过滤、且依赖导出不确定的内部函数而排除）。

## 3. 可行性（已核对 SillyTavern 源码）

`getContext()` 对扩展暴露：
- `loadWorldInfo(name)` —— 读取某本世界书，返回 `{ entries: { <uid>: <entry> } }`（已确认导出）
- `getWorldInfoNames()` —— 返回全部世界书名数组（已确认导出）
- `saveWorldInfo` / `getWorldInfoPrompt` 等（本设计不使用）

世界书条目（entry）字段（取本设计需要的）：
- `key: string[]` —— 主关键词
- `keysecondary: string[]` —— 次关键词
- `content: string` —— 正文
- `comment: string` —— 标题/备注
- `constant: boolean`、`disable: boolean` —— 常驻 / 禁用

"激活的书"的来源（**实现前需做一次取数路径确认，见 §9**）：
- 聊天绑定：`chat_metadata['world_info']`（`METADATA_KEY === 'world_info'`）
- 角色卡主书：`character.data.extensions.world`
- 全局选中：`selected_world_info`（在 `world-info.js` 导出，但**不**在 `getContext()` 上）

## 4. 架构

### 4.1 新增设置（SECTION 2 `defaultSettings`）

沿用项目约定"往 `defaultSettings` 加 key 即加设置"。

| key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `worldBookEnabled` | bool | `false` | 世界书注入总开关 |
| `worldBookSectionHeadings` | string | `"外貌,长相,外观,appearance,场景,环境,setting,scene"` | 要抽取的小节标题（逗号分隔） |
| `worldBookMaxChars` | number | `800` | 注入总字数上限，防提示词膨胀 |

保留现有 `characterAppearance` 作为**手动兜底**。

> ⚠️ 注意 `ensureSettings()` 的合并方向是"已存值覆盖默认值"，老用户改默认常量不生效——新设置默认 `false`，老用户需手动开启。

### 4.2 新增函数（SECTION 15，紧挨 `injectCharacterAppearance`）

- `getActiveWorldBookNames(): string[]`
  聚合当前激活的书名：聊天绑定 + 角色卡书（+ 全局选中，视 §9 确认结果）。去重、去空。

- `async loadActiveWorldBookEntries(): Promise<Array<{keys: string[], content: string, comment: string}>>`
  对每个激活书名调 `getContext().loadWorldInfo(name)` → 摊平 `entries` → 滤掉 `disable === true` → 归一成 `{keys: [...key, ...keysecondary], content, comment}`。
  带模块级缓存（按激活书名签名缓存），`CHAT_CHANGED` 时清空。

- `extractEntrySection(content: string, headings: string[]): string`
  在 `content` 里按小节标题（如 `外貌：`、`appearance:`）定位对应段，截取到下一个小节标题 / 空行 / 结尾。
  - 命中标题 → 返回该段（含标题行，正文截到下一个小节标题 / 空行 / 结尾）。
  - 未命中任何标题 → 返回整条 `content`。
  - 单条先截断到 300 字上限（防单条人设过长）。

- `async injectStableDescriptions(prompt: string, settings: object): Promise<string>`
  **编排器**（替换流水线里原 `injectCharacterAppearance` 的位置）：
  1. 若 `worldBookEnabled` 且 `typeof getContext().loadWorldInfo === 'function'`：
     - `entries = await loadActiveWorldBookEntries()`
     - 对每条 entry：若其任一 `key`（长度 ≥ 2）是 `prompt` 的子串 → `section = extractEntrySection(content, headings)` → 收集 `{name: comment||firstKey, text: section}`，并把命中的 key 与 comment 记入 `covered` 集合。
  2. **手动兜底**：解析 `characterAppearance` 的 `名字：外貌` 行；对出现在 `prompt` 中、且名字**不在** `covered` 里的角色 → 收集。
  3. 合并收集结果：按文本去重 → 按收集顺序累加，累计达到 `worldBookMaxChars` 即停止追加后续条目 → 拼成 `【设定参考】\n...` 块追加到 `prompt` 末尾返回。
  4. 若什么都没收集到 → 原样返回 `prompt`。
  5. 任意异常 → `catch` 后退回"仅手动兜底"或原样返回，并 `console.warn`。

> 现有 `injectCharacterAppearance` 的"`名字：外貌`解析 + 仅注入提示词中出现的角色"逻辑被复用为第 2 步（可重构为接受 `covered` 集合参数的纯函数）。

### 4.3 接入流水线（改动很小）

- `processPromptPipeline()` 的 Step 3：
  `prompt = injectCharacterAppearance(prompt, settings.characterAppearance)`
  → `prompt = await injectStableDescriptions(prompt, settings)`
- `summarizeAndGenerate()` 里那次直接调用同步替换为 `await injectStableDescriptions(...)`。
- `CHAT_CHANGED` 事件处理器：顺手清空世界书条目缓存。

（`processPromptPipeline` 与所有调用方已是 async/await，改为 await 无连锁影响。）

## 5. 数据流

```
processPromptPipeline(prompt):
  optimize（可选, LLM）
  → sanitize（可选, LLM）
  → injectStableDescriptions(prompt, settings)        ← Step 3（本设计；改为 await）
       ├─ 世界书路（worldBookEnabled 且 API 可用）:
       │     loadActiveWorldBookEntries()
       │       → 对每条 entry: key(≥2字) ⊂ prompt ?
       │            → extractEntrySection(content, headings)
       │            → 收集 + 记录 covered（人物名/地点名）
       └─ 手动兜底:
             characterAppearance 的「名字：外貌」中
             出现在 prompt 且不在 covered 的 → 收集
       → 去重 + 总长封顶(worldBookMaxChars)
       → prompt += "\n\n【设定参考】\n" + 合并文本
  → requestImagesFromBackend(prompt)
```

## 6. WI 优先 / 手动兜底 的配合

编排器先跑世界书路，把命中的实体名（entry 的 `key` 与 `comment`）记入 `covered`；手动兜底只注入 `covered` 之外、且出现在 prompt 中的角色。由此实现"世界书优先、手动兜底"，且不重复注入同一角色。

## 7. UI 改动（「优化」tab 加「世界书」小节）

- 新增控件：`#oair_worldbook_enabled`（开关）、`#oair_worldbook_headings`（小节标题输入）、`#oair_worldbook_maxchars`（总字数上限）。
- 原「固定角色外貌」区块文案改标注为"(兜底：世界书未覆盖到的角色)"。
- ⚠️ **项目铁律：UI 双份同步**——`settings_full.html` 与 index.js 内联的 `SETTINGS_FULL_HTML` 常量都要改；并在 `bindSettingInput` / `updateFloatingUi`（`load`）里加新字段绑定。DOM id 前缀 `oair_`，class 前缀 `oair-`，文案中文。

## 8. 边界与降级（全部静默退回手动兜底/原样，契合既有流水线风格）

- `worldBookEnabled` 关 → 跳过世界书路。
- 老版 ST：`getContext().loadWorldInfo` 不是函数 → 运行时特性检测后跳过世界书路。
- `loadWorldInfo` 抛错 / 无激活书 / 条目为空 → `catch` 后退回手动兜底。
- `key` 长度 < 2 字的跳过，防误命中（如单字"我""他"）。
- 注入累计达到 `worldBookMaxChars` → 停止追加后续条目；单条先截到 300 字。
- 同一文本被人物/地点重复收集 → 去重。

## 9. 待验证点（实现时先做一次小确认）

`getContext()` 实际暴露哪些字段来枚举"激活的书"：
- 确认 `getContext().chatMetadata?.world_info`（聊天绑定）是否可读。
- 确认 `getContext().characters?.[getContext().characterId]?.data?.extensions?.world`（角色卡主书）路径。
- 全局选中 `selected_world_info` 不在 `getContext()` 上：决定是否从 `../../../world-info.js` 直接 `import`（该模块确认导出 `selected_world_info`、`world_names`；新增 import 与现有 `../../../utils.js` 等同级，路径风险低），或本期仅支持聊天/角色绑定的书。

此点只影响"取哪些书名"，不影响整体架构。建议落地顺序：先实现聊天+角色绑定（最可靠），全局选中作为可选增强。

## 10. 验证方式（项目无测试框架）

- **纯逻辑**（`extractEntrySection`、key 子串匹配、`covered` 去重、`injectStableDescriptions` 喂 mock 条目）→ 沿用本会话的 Node `tmp_*.mjs` 脚本验证（把纯函数原样拷出跑断言），跑完即删。
- **ST 耦合部分**（`getActiveWorldBookNames`、`loadActiveWorldBookEntries`、UI）→ 复制扩展到 `third-party/`、浏览器内手测，看 DevTools 控制台 `[ST-OpenAI-Image-Relay]` 日志。
- 改完 `node --check`（以 `.mjs` 解析）做语法校验。

## 11. 涉及文件

- `index.js`：`defaultSettings`（+3 key）、SECTION 15（+4 函数、复用/重构 `injectCharacterAppearance`）、`processPromptPipeline` Step 3、`summarizeAndGenerate`、`CHAT_CHANGED` 处理器、`SETTINGS_FULL_HTML` 内联常量、`bindSettingInput`/`updateFloatingUi`、（视 §9）新增 `world-info.js` import。
- `settings_full.html`：新增「世界书」小节 + 「固定角色外貌」文案。
- `CLAUDE.md`：实现后把世界书注入写进流水线说明与设置说明。
- `manifest.json`：版本号 bump（实现时）。

## 12. 未来可扩展（明确排除在本期外）

- 升级为复用 ST 扫描器 `getWorldInfoPrompt`，获得真正的激活语义与"当前激活场景"动态带入。
- 支持 `constant`（常驻）条目无条件注入。
- 全局选中书 / charLore 额外书的完整覆盖。
