# 预设库弹窗 + 人物/场景提取设计文档

- 日期：2026-06-08
- 状态：设计确认执行（来自 `/goal`）
- 关联扩展：ST-OpenAI-Image-Relay
- 前置特性：`2026-06-08-fixed-style-character-design`（风格/人物固定设定注入优化模板）

## 1. 背景

上一轮已把固定设定接入提示词优化模板：`resolveFixedSettings` 收集风格与人物，`{{style}}`/`{{characters}}` 注入优化模板，降级时通过 `appendFixedBlock` 拼接。当前目标进一步把「设定」tab 从大文本框改成更可维护的三类库：**风格库、人物库、场景库**。其中风格库只需预设列表；人物库与场景库需要从多来源提取：手动预设、世界书、对话内容。

## 2. 目标

- 风格库不再展示 textarea，改为摘要 +「管理风格预设」弹窗列表。
- 人物库改为摘要 +「管理人物预设」弹窗列表，并提供「从对话提取」「从世界书提取」。
- 世界书人物设定支持二选一模式：
  - `inject`：生图时即时读取世界书注入（旧行为）。
  - `extract`：世界书只作为提取按钮来源，不在生图时即时注入。
  - `off`：关闭世界书来源。
- 新增场景库，UI、提取方式与人物库同构，并接入提示词优化模板。
- 数据兼容：继续用多行 `名字：描述` 存储库内容，复用现有解析与匹配逻辑。

## 3. 非目标

- 不引入外部 UI 框架。
- 不做复杂实体数据库或标签系统。
- 不改变图片后端协议。
- 不实现完整 SillyTavern 世界书激活语义，只复用现有 `loadActiveWorldBookEntries` 与关键词/小节提取。

## 4. 数据模型

新增或落实以下设置：

| key | 类型 | 默认 | 含义 |
|---|---|---|---|
| `worldBookMode` | string | derived | `off` / `inject` / `extract`；兼容 `worldBookEnabled` |
| `sceneLibrary` | string | `""` | 场景库，多行「场景名：描述」 |
| `sceneActive` | string | `""` | 当前固定场景名 |
| `sceneAutoSelect` | bool | `false` | LLM 按场景原文自动选场景 |

兼容规则：
- 若无 `worldBookMode` 且 `worldBookEnabled === true`，按 `inject` 处理。
- 保存/规范化时保持 `worldBookEnabled = worldBookMode === "inject"`。

## 5. UI 设计

「设定」tab 分四段：

1. **风格库**：隐藏 `#oair_style_library` / `#oair_style_active` 保存原文本；展示 `#oair_style_library_summary` 与按钮 `#oair_btn_style_library`。弹窗中可新增/编辑/删除预设，并设为当前固定风格。
2. **人物库**：隐藏 `#oair_character_appearance` 保存文本；展示摘要与按钮：管理人物预设、从对话提取、从世界书提取。
3. **场景库**：隐藏 `#oair_scene_library` / `#oair_scene_active` 保存文本；展示摘要与按钮：管理场景预设、从对话提取、从世界书提取。
4. **世界书来源**：radio 三选一：关闭 / 生图时注入 / 仅提取到库。`inject` 与 `extract` 互斥。

弹窗由 JS 动态创建，不写死多份复杂 HTML：
- `.oair-library-modal` 覆盖层
- `.oair-library-dialog` 内容框
- 每行：名称 input、描述 textarea、删除按钮、可选「设为当前」按钮
- 底部：新增、保存、取消

## 6. 提取设计

### 从世界书提取

复用 `loadActiveWorldBookEntries()`：
- 人物提取：使用 `worldBookSectionHeadings` 中外貌相关段，候选名用 entry comment 或第一个 key。
- 场景提取：同样从世界书条目抽段，候选名用 comment/first key。第一版不过度分类，按钮由用户语义决定：点人物提取就写人物库，点场景提取就写场景库。
- 提取后打开同一个库弹窗，预填候选，用户保存才落入设置。

### 从对话提取

取最近 8 条非空聊天消息，清理 HTML/RP 噪声后调用 `callLlmForText`：
- 人物：输出 `{"items":[{"name":"...","description":"..."}]}`。
- 场景：输出同结构。
- 宽松 JSON 解析，失败时 toast 提示，不改设置。

## 7. 流水线接入

`resolveFixedSettings` 返回扩展为：

```js
{ styleText, charactersText, sceneText }
```

场景收集规则：
- `sceneAutoSelect` 开：分析调用可返回 `scene`，从 `sceneLibrary` 查描述。
- `sceneAutoSelect` 关：使用 `sceneActive`。
- 若当前原文命中场景库名，也可收集命中项；固定 `sceneActive` 优先。

优化模板新增 `{{scene}}` 模块。`renderOptimizeTemplate` 替换 `{{scene}}`，空值为「（本图无需固定场景设定）」。

`appendFixedBlock` 降级块中增加场景：

```text
【设定参考】
风格：...
人物...
场景：...
```

## 8. 错误处理与降级

- 弹窗取消不保存。
- 提取失败：toast.warning / toast.error，不覆盖现有库。
- 世界书无激活/无 API：提取按钮提示未找到可提取条目。
- 老模板无 `{{scene}}`：通过 `appendFixedBlock` 降级拼接。
- 旧 `worldBookEnabled` 设置继续有效。

## 9. 验证

- `node --check` 校验语法。
- 纯函数用一次性 `.mjs` 验证：库序列化/合并、世界书模式规范化、scene 模板渲染、提取 JSON 解析。
- 浏览器手测：
  1. 风格/人物/场景库均可打开弹窗新增、编辑、删除、保存。
  2. 风格库无直接 textarea。
  3. 人物/场景从世界书提取可预填弹窗并保存。
  4. 人物/场景从对话提取失败时不破坏库。
  5. worldBookMode 为 `extract` 时生图流程不即时读世界书。
  6. scene 进入优化模板或降级块。
