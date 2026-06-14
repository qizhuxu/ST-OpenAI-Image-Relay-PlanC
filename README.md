# OpenAI Image Relay（OpenAI 图像中继）

一个 **SillyTavern 第三方扩展**：把 AI 消息、手动输入或消息按钮来源转换为图片后端可用的 prompt，请求任意兼容 OpenAI 接口的生图后端，并把生成图片附加回聊天消息或显示在工作台预览中。

当前版本已经移除旧版 `<pic prompt="...">` 主模型提示注入和标签提取路径。扩展不会再要求主聊天 LLM 在正常回复中输出控制标签，也不会把消息里的 `<pic prompt="...">` 文本当作自动生图命令；这样可以避免插件语法污染主回复质量。

> 浏览器端纯 ES 模块，无需构建、无需打包。由 SillyTavern 通过 `manifest.json` 在运行时加载，**不能**单独运行。

---

## 核心特性

- **自动整条 AI 消息生图**：可选开启；每条新 AI 消息经 `cleanRpText()` 清洗、满足最小字数后进入同聊天串行队列，再按当前工作台模式、张数、对白和失败策略生成并附加回原消息。
- **单图 / 多图 / 漫画三种模式**：单图先按剧情高潮、总结海报或最后镜头规划画面目标，再由本地提示词编译器生成 prompt；多图按 2-6 个 StoryBeat 递进生成；漫画按 2-8 格分镜生成并保留对白元数据。
- **手动生图工作台**：在悬浮面板「生成工作台」里输入剧情或提示词，选择模式后直接出图；进度、错误和诊断文本有高度约束，结果以缩略图卡片预览，点击进入灯箱左右切换查看。
- **消息生图按钮**：每条消息操作栏可显示直接生图和总结生图按钮；总结入口会先把消息压成视觉目标，再进入统一生图链路。
- **当前角色卡视觉库 / Visual Bible**：每个角色卡拥有自己的风格、人物、场景、确认人物和来源诊断；旧全局库、旧聊天作用域、世界书或剧情候选只作为回退/显式导入来源。
- **内置风格 / built-in style presets**：插件自带 3 个风格预设，空角色卡也能看到；点击导入后只追加到当前角色卡风格库，不覆盖用户已有风格。
- **自动设定提取**：`autoExtractCharactersEnabled` 和 `autoExtractScenesEnabled` 默认关闭；开启后每条新 AI 消息会保守提取人物/场景视觉条目，只写入当前角色卡 Visual Bible。
- **Prompt Preflight / 本地编译 / 可选精修 / 安全分类**：`prompt_preflight.mjs` 在每次请求图片后端前创建 PromptDraft；本地编译是必经权威步骤，LLM 精修只是可选后置步骤，风险分类必跑，安全重写按风险或 policy retry 条件触发。
- **Prompt Trace 诊断**：每个 ImageJob 会保留有界的阶段诊断，覆盖清洗、候选画面、人物绑定、编译 prompt、精修/安全重写和最终投喂生图后端的 prompt，方便排查人物在哪一步丢失。
- **两种后端模式**：`Chat Completions` 与 `Images API`，自适应解析结构化图片、Markdown 图片、data URI 和图片 URL。
- **一键 chatgpt2api 预设**：一个按钮切换到 [chatgpt2api](https://github.com/basketikun/chatgpt2api) 的推荐配置。

---

## 当前实现状态

- 旧 `<pic prompt="...">` 主模型提示注入已从运行路径移除；保存过的 `mainPrompt` 和 `extractionRegex` 只作为迁移兼容数据保留，不参与生图。
- 新 AI 消息中即使出现 `<pic prompt="...">` 文本，也只会作为普通正文；开启自动整条消息时会按整条消息规划，关闭时不会自动生图。
- 设定库已改为**当前角色卡视觉库 profile**：切换到角色卡 B 时不会显示角色卡 A 的人物或场景，新角色卡 C 默认空白。
- `retry` 是可保存的失败策略：失败 job 会保留 prompt、错误分类、错误摘要和可重试状态；policy 失败会显示“安全重试”，每个 job 最多自动安全重试一次。
- 多图拆分少于请求张数时，会生成可见的缺失 StoryBeat 占位 job，并可从预览或历史中单独重试补齐。
- 工作台进度、错误和诊断文本会自动换行并限制高度；预览区使用缩略图网格，避免日志和大图挤出面板。
- 「图库历史」包含落盘图库、轻量生成历史、失败记录和历史重试入口；历史只保存短路径和元数据，不保存 base64 图片字节。
- 真实图生图/图片编辑连续性仍是后续预留；当前连续性只记录参考图元数据，不改变文生图请求。

---

## 安装

把本扩展文件夹放到 SillyTavern 的第三方扩展目录下：

```text
SillyTavern/public/scripts/extensions/third-party/<本扩展文件夹>/
```

文件夹内至少包含 `index.js`、`manifest.json`，建议连同 `prompt_compiler.mjs`、`prompt_preflight.mjs`、`settings_panel.html`、`settings_full.html`、`style.css` 一起复制。

装好后**硬刷新**浏览器（Ctrl/Cmd + Shift + R）。在「扩展设置」里出现 **「图片中继」** 抽屉即表示加载成功。

排查问题时打开浏览器开发者工具（F12）→ Console，所有日志都以 `[ST-OpenAI-Image-Relay]` 前缀输出。

---

## 快速上手

1. 打开「扩展设置」→ 展开 **「图片中继」** 抽屉（L0）。
2. 勾选 **启用**，点击 **打开详细配置** 打开悬浮配置窗（L2）。
3. 到 **「模型后端」** 标签：
   - 用 **universal-web-api** 等通用后端：保持默认即可（地址 `http://127.0.0.1:8199/v1`，密钥 `sk-any`，模型 `any`，Chat 模式）。
   - 用 **chatgpt2api**：点击 **「一键 chatgpt2api 预设」**，再确认地址与密钥。
4. 先到 **「生成工作台」** 输入一句简单提示词测试出图，确认后端通了。
5. 想自动为新 AI 消息生图时，在「生成工作台」开启 **自动整条 AI 消息生图**。关闭时，新 AI 消息不会自动生图。

旧版做法“让主模型输出 `<pic prompt="...">`”已经不是当前入口；不要再把它写进角色卡、主提示词或系统提示词。

---

## 生图入口和模式

| 入口 | 触发点 | 行为 |
| --- | --- | --- |
| **整条消息自动** | 「生成工作台」开启自动整条 AI 消息生图 | 新 AI 消息经清洗和最小字数检查后进入同聊天串行队列，按当前工作台模式生成，图片附加回原消息；不改写正文 |
| **手动工作台** | 在「生成工作台」输入源文本并点击生成 | 单图先规划取景目标并本地编译 prompt；多图拆 StoryBeat；漫画拆 ComicPanel 并保留插件气泡/对白元数据 |
| **直接消息生图** | 消息操作栏图片按钮 | 用该条消息的正文清洗结果创建 ImageJob，生成后附加到该消息 |
| **总结生图** | 消息操作栏总结按钮 | 先用文本模型把消息总结成视觉目标，再进入单图规划、编译、安全分类和图片请求 |
| **历史/失败重试** | 图库历史里的重试按钮 | 复用原 ImageJob 诊断和 PromptDraft，必要时走 policy 安全重写后再次请求 |

多图和漫画是工作台/自动/按钮入口共用的生成模式，不再由 `<pic>` 标签属性触发。消息里出现 `<pic prompt="...">` 只会被当成正文的一部分。

---

## 当前角色卡视觉库 / Visual Bible

设定库现在按**当前角色卡**拥有视觉库 profile。人物库、场景库、当前风格、当前场景和手动确认的人物都会写入当前角色卡作用域；切换到角色卡 B 时不会显示角色卡 A 的库，新角色卡 C 默认没有 A/B 的人物或场景。

每次生成前，扩展会从当前角色卡作用域解析一份 **Visual Bible**：风格、人物外貌、场景环境、确认人物、user/persona 候选、缺失固定外貌的人物、连续性和负面约束。单图、多图、漫画、手动生成、自动整条消息和 policy 安全重试都会复用这份 Visual Bible，再进入本地 prompt compiler。

「设定库」里会显示插件内置的 3 个 built-in style presets。它们属于插件预设目录，不会在打开新角色卡时自动写入库；点击「导入内置风格到当前角色卡」才会把缺失的预设追加到当前角色卡 `styleLibrary`。

自动设定提取是可选功能：`autoExtractCharactersEnabled` 控制每条新 AI 消息后自动提取人物库，`autoExtractScenesEnabled` 控制自动提取场景库。两个开关默认关闭；开启后，提取结果只通过当前角色卡 scope 写入，重复名称不会覆盖手动编辑条目。

---

## Prompt Preflight / 编译 / 精修 / 安全重写

当前发给图片后端的 final image backend prompt 由固定链路生成：

```text
source message / manual input
→ cleanRpText / cleanPromptSource
→ ImagePlan / ImageJob
→ Visual Bible binding
→ prompt_compiler.mjs local compile
→ prompt_preflight.mjs PromptDraft validation
→ optional LLM refinement
→ mandatory safety classification
→ conditional safety rewrite / policy retry prompt
→ requestImagesFromBackend
```

- **规划**：单图用本地策略从长剧情中选择一个可绘制画面目标；多图/漫画先用文本模型拆 StoryBeat 或 ComicPanel。
- **预检**：`prompt_preflight.mjs` 是所有入口请求图片后端前的统一边界。它会清理 HTML/CSS、隐藏思考、数值状态、选项列表、安全样板文本和抽象主题尾句，创建 PromptDraft，并记录 sourceText、cleanedText、visualMoment、visible/non-visual characters、protected references、riskReport、validation 和 finalPrompt。
- **本地编译**：`prompt_compiler.mjs` / `compileImagePrompt` 把计划和 Visual Bible 转换成图像后端友好的 prompt，包含主体、出场人物、镜头构图、动作表情、场景光影、视觉锚点、连续性、文字/对白策略和负面约束。编译不会调用 LLM。
- **精修**：原「提示词优化」现在是可选后置步骤。`optimizeEnabled` 控制是否允许精修，`optimizeAuto` 控制是否自动精修；精修候选必须通过 PromptDraft 校验，不能丢失受保护的人物、场景、风格或对白策略。
- **安全分类**：safety classification / 风险分类是必经步骤，会判断风险来自源文本、人物库、场景库、动作、编译 prompt 还是精修 prompt。
- **安全重写**：safety rewrite 是 conditional / 条件触发流程，只在风险分类要求、用户启用相应安全处理、或 policy retry 需要时触发。它优先做字段级定向改写，并保留允许的人物名、SFW 外貌锚点、场景锚点、构图和对白策略。
- **cleanup template**：清洗模板是 inactive / reserved 兼容项；当前清洗由 `prompt_preflight.mjs` 本地完成。

文本步骤默认使用酒馆的主对话模型（通过 SillyTavern 自身代理，无需填 URL/密钥、无跨域问题）。这只是用于总结、规划、可选精修或安全重写，不是主模型提示注入，也不会要求主聊天回复输出 `<pic>`。

---

## Prompt Trace 诊断

每个生成 job 会在 `promptDiagnostics` / PromptDraft 摘要里保存有界 trace。你可以在以下位置查看：

- 生成工作台进度卡和失败摘要。
- 图库历史的生成记录和失败记录。
- 浏览器 Console 中 `[ST-OpenAI-Image-Relay]` 前缀日志。

trace 会记录清洗后文本、被移除片段摘要、visualMoment 候选和选中结果、人物库/场景库命中、visible/nonVisual characters、编译后 prompt、精修或安全重写决策、最终投喂图片后端的 prompt。长字段会被截断，图片 data URI / base64 不会写入 trace。

---

## 后端配置

### chatgpt2api 预设

[chatgpt2api](https://github.com/basketikun/chatgpt2api) 是一个**只生图**的 OpenAI 兼容后端。在 **「模型后端」** 标签顶部点击 **「一键 chatgpt2api 预设」**，会套用推荐配置：

| 项目 | 值 |
| --- | --- |
| API 模式 | **Images API** |
| 模型 | `gpt-image-2` |
| 响应格式 | `b64_json` |
| 提示词模板 | `{{prompt}}`（直通，不额外包装） |
| 文本步骤（精修/安全重写/总结） | 走酒馆主模型 |
| 超时 | `600000` 毫秒 |
| 服务地址 | 仅在为空或仍是默认值时填入 `http://127.0.0.1:3000/v1` |

预设不会覆盖你已填写的 API 密钥，也不会改动你自定义过的服务地址。

### API 模式

- **Chat Completions（`chat`）** → `POST /v1/chat/completions`。适配把图片塞进对话回复的后端；针对 chatgpt2api，请求体会自动注入 `modalities:["image"]`。
- **Images API（`images`）** → `POST /v1/images/generations`。标准 OpenAI 图像接口，可设尺寸、数量、响应格式（`url` / `b64_json`）。

### 响应解析

「响应图像正则」只用于解析图片后端返回内容，不是消息触发正则。Chat 模式按优先级依次尝试：

1. 结构化字段：`media` / `images` / `choices[0].message.media` / `choices[0].message.images`
2. 多模态 `content[].image_url`
3. 你配置的「响应图像正则」
4. 内置 Markdown 图片正则（`![](url)`，含 data URI）
5. 宽泛的图片 URL 兜底匹配

Images 模式读取 `data[].url` / `data[].b64_json`，外加顶层 `images` 兜底。

---

## 故障排查

- **抽屉没出现 / 报错**：确认文件夹在 `third-party/` 正确深度下且含 `index.js`、`manifest.json`，然后硬刷新。看 Console 里 `[ST-OpenAI-Image-Relay]` 日志。
- **不出图**：先用「生成工作台」测后端连通性；检查服务地址、密钥、模型、API 模式是否匹配你的后端。若后端生图慢，把「模型后端」的「超时」调大到 `600000`。
- **自动消息没有生图**：确认「自动整条 AI 消息生图」已开启，消息不是用户/系统消息，正文长度满足最小字数，且消息没有已有自动生成图片。
- **消息里写了 `<pic prompt="...">` 但没有自动生成**：这是当前设计。旧路径已移除，请开启整条消息自动生图、使用工作台，或点击消息生图按钮。
- **提示词质量不稳 / 人物不一致**：先看生成工作台、历史记录或 job diagnostics 里的 Visual Bible 摘要和 Prompt Trace，确认当前角色卡 scope、命中人物、缺失外貌、visible/nonVisual characters 和最终 backend prompt。
- **被后端风控**：查看风险分类和安全重写 trace。policy 失败会被归类为 policy 错误；只有未重试过的 job 才会显示“安全重试”，且每个 job 最多一次。

---

## 本地开发同步

本仓库没有构建步骤。修改插件文件后，把运行文件同步到本地 SillyTavern 第三方扩展目录：

```powershell
Copy-Item index.js,prompt_compiler.mjs,prompt_preflight.mjs,manifest.json,settings_panel.html,settings_full.html,style.css `
  ..\SillyTavern\public\scripts\extensions\third-party\ST-OpenAI-Image-Relay-PlanC\ -Force
```

可用轻量测试和语法检查：

```powershell
node --test tests\*.test.mjs
node --check index.js
node --check prompt_compiler.mjs
node --check prompt_preflight.mjs
openspec validate remove-legacy-pic-prompt-path --strict
```

本地测试 SillyTavern 当前在 `http://127.0.0.1:8258/`（以 `../SillyTavern/config.yaml` 为准）。同步后对浏览器做硬刷新，并在 Console 查看 `[ST-OpenAI-Image-Relay]` 日志。

---

## 默认后端

shipped 默认设置指向 `http://127.0.0.1:8199/v1`（密钥 `sk-any`，模型 `any`，Chat 模式），匹配 [universal-web-api](https://github.com/lumingya/universal-web-api)。任何兼容 OpenAI 接口的服务都可用；只生图的后端推荐配合一键 chatgpt2api 预设使用。
