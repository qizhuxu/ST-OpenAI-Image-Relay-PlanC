# UI/UX 批次：磁盘落盘 + 图库 + 标签页重构 + 拖动修复 + 视觉 实施计划

> **For agentic workers:** 本计划由 executing-plans 内联执行，逐 Task 自检检查点。步骤用 `- [ ]` 跟踪。

**Goal:** 让生成的图片真正落盘持久化（顺带治聊天 base64 膨胀），新增「图库」与「世界书」两个独立标签页（5→7），修复手机端悬浮窗难以拖动，并做主题色视觉统一。

**Architecture:** 在唯一的生图 choke point `requestImagesFromBackend()` 后置一步「落盘 + 记录图库」：data-URI 图经 `saveBase64AsFile`（ST 自带 `utils.js` 导出）写入 `user/images/<角色>/`，换回短路径；该路径既写进消息 `extra.media`（聊天不再内联大 base64），也写进 localStorage 图库索引（仅存 URL+提示词+时间，极轻量）。图库/世界书各自独立标签页。拖动修复为 CSS 根因修复（`touch-action:none`）。

**Tech Stack:** 原生 ES module、jQuery（ST 全局）、`saveBase64AsFile`（`../../../utils.js`）、localStorage、CSS-only 标签页（隐藏 radio + `:checked ~` 兄弟选择器）。

**关键约束（务必遵守）：**
- HTML/CSS 双副本：`settings_full.html`（主，`$.get` 加载）↔ `index.js` 内联 `SETTINGS_FULL_HTML`（回退）。**改 `settings_full.html` 后用 Task 末尾的 regen 脚本重新生成内联常量**，禁止手改那一行。
- 标签页系统 CSS 只在 `settings_full.html` 内联 `<style>`（→ regen 进 `SETTINGS_FULL_HTML`）；悬浮窗外壳（header）CSS 只在 `style.css`。
- 注释/UI/状态文案全用中文。DOM id 前缀 `oair_`，class 前缀 `oair-`，jQuery 命名空间 `.oair*`。
- 落盘失败必须静默回退原图（不阻断生图主流程）；失败回退的 base64 **不**写入 localStorage 图库（避免撑爆）。
- `Date.now()`/`Math.random()` 在浏览器扩展代码里可正常使用（仅 Workflow 脚本禁用）。

---

## File Structure

- `style.css` — 悬浮窗外壳样式。改：`.oair-floating-header` 加 `touch-action`。
- `settings_full.html` — 悬浮窗完整 UI（主副本）。改：标签页 5→7、移动世界书两节、新增图库面板、内联 `<style>` 加图库样式与主题色。
- `index.js` — 全部逻辑。改：import、tabMap×2、`requestImagesFromBackend` 后置落盘、新增 SECTION 17（落盘+图库）、`bindFloatingEvents` 接线、`loadFullSettings` 调 `refreshGalleryUi`。
- `manifest.json` — 版本 1.8.0 → 1.9.0。
- `CLAUDE.md` — 补充落盘/图库/7 标签的架构说明。
- 部署副本：`E:\AI\SillyTavern\public\scripts\extensions\third-party\ST-OpenAI-Image-Relay-PlanC\` — 全部完成后整目录覆盖。

---

## Task 1: 手机端拖动修复（CSS 根因）

**根因：** `.oair-floating-header`（style.css:204）缺 `touch-action: none`；FAB（style.css:25）有它且拖动正常。无此属性时浏览器把 header 上的触摸判定为页面平移手势，touchmove 被原生滚动抢走 → 「极端一般很难拖动」。

**Files:** Modify: `style.css:204-213`

- [ ] **Step 1: 给 `.oair-floating-header` 加 `touch-action: none`**

把：
```css
.oair-floating-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
}
```
改为（新增最后两行）：
```css
.oair-floating-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
}
```

- [ ] **Step 2: 验证** — `git diff style.css` 仅这两行新增；`.oair-floating-header` 块内有 `touch-action: none;`。浏览器手测留待最终清单。

---

## Task 2: 标签页重构 5 → 7（世界书 + 图库 独立 tab）

新增 `📖 世界书`、`🖼️ 图库` 两个标签。把「世界书注入」「固定角色外貌（兜底）」两节从 `优化` tab 移到新的 `世界书` tab；`优化` tab 保留 提示词优化 / NSFW / 消息总结。新增空的图库面板外壳（Task 3 填逻辑）。标签栏顺序：基础 后端 提取 优化 世界书 手动 图库。

**Files:** Modify: `settings_full.html`（radios、labels、CSS 选择器、移动两节、新增图库面板）；`index.js`（tabMap×2，行 192-198 与 735-741）；然后 regen `SETTINGS_FULL_HTML`。

- [ ] **Step 1: 新增两个 radio 输入**（`settings_full.html` 第 280-284 块）

把：
```html
    <input type="radio" name="oair_tab" id="oair_tab_basic" checked style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_backend" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_extract" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_optimize" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_manual" style="display:none">
```
改为：
```html
    <input type="radio" name="oair_tab" id="oair_tab_basic" checked style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_backend" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_extract" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_optimize" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_worldbook" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_manual" style="display:none">
    <input type="radio" name="oair_tab" id="oair_tab_gallery" style="display:none">
```

- [ ] **Step 2: 新增两个标签栏 label**（第 287-293 块）

把：
```html
    <div class="oair-tab-bar">
        <label for="oair_tab_basic" class="oair-tab-label">📋 基础</label>
        <label for="oair_tab_backend" class="oair-tab-label">⚙️ 后端</label>
        <label for="oair_tab_extract" class="oair-tab-label">🔍 提取</label>
        <label for="oair_tab_optimize" class="oair-tab-label">✨ 优化</label>
        <label for="oair_tab_manual" class="oair-tab-label">🎨 手动</label>
    </div>
```
改为：
```html
    <div class="oair-tab-bar">
        <label for="oair_tab_basic" class="oair-tab-label">📋 基础</label>
        <label for="oair_tab_backend" class="oair-tab-label">⚙️ 后端</label>
        <label for="oair_tab_extract" class="oair-tab-label">🔍 提取</label>
        <label for="oair_tab_optimize" class="oair-tab-label">✨ 优化</label>
        <label for="oair_tab_worldbook" class="oair-tab-label">📖 世界书</label>
        <label for="oair_tab_manual" class="oair-tab-label">🎨 手动</label>
        <label for="oair_tab_gallery" class="oair-tab-label">🖼️ 图库</label>
    </div>
```

- [ ] **Step 3: 扩展激活标签 CSS 选择器**（第 37-45 块）

把：
```css
    #oair_tab_basic:checked ~ .oair-tab-bar label[for="oair_tab_basic"],
    #oair_tab_backend:checked ~ .oair-tab-bar label[for="oair_tab_backend"],
    #oair_tab_extract:checked ~ .oair-tab-bar label[for="oair_tab_extract"],
    #oair_tab_optimize:checked ~ .oair-tab-bar label[for="oair_tab_optimize"],
    #oair_tab_manual:checked ~ .oair-tab-bar label[for="oair_tab_manual"] {
        opacity: 1;
        background: rgba(255,255,255,0.1);
        border-bottom: 2px solid cyan;
    }
```
改为：
```css
    #oair_tab_basic:checked ~ .oair-tab-bar label[for="oair_tab_basic"],
    #oair_tab_backend:checked ~ .oair-tab-bar label[for="oair_tab_backend"],
    #oair_tab_extract:checked ~ .oair-tab-bar label[for="oair_tab_extract"],
    #oair_tab_optimize:checked ~ .oair-tab-bar label[for="oair_tab_optimize"],
    #oair_tab_worldbook:checked ~ .oair-tab-bar label[for="oair_tab_worldbook"],
    #oair_tab_manual:checked ~ .oair-tab-bar label[for="oair_tab_manual"],
    #oair_tab_gallery:checked ~ .oair-tab-bar label[for="oair_tab_gallery"] {
        opacity: 1;
        background: rgba(255,255,255,0.1);
        border-bottom: 2px solid cyan;
    }
```
（`cyan` 留待 Task 4 改主题色。）

- [ ] **Step 4: 扩展显示面板 CSS 选择器**（第 48-54 块）

把：
```css
    #oair_tab_basic:checked ~ #oair_panel_basic,
    #oair_tab_backend:checked ~ #oair_panel_backend,
    #oair_tab_extract:checked ~ #oair_panel_extract,
    #oair_tab_optimize:checked ~ #oair_panel_optimize,
    #oair_tab_manual:checked ~ #oair_panel_manual {
        display: block;
    }
```
改为：
```css
    #oair_tab_basic:checked ~ #oair_panel_basic,
    #oair_tab_backend:checked ~ #oair_panel_backend,
    #oair_tab_extract:checked ~ #oair_panel_extract,
    #oair_tab_optimize:checked ~ #oair_panel_optimize,
    #oair_tab_worldbook:checked ~ #oair_panel_worldbook,
    #oair_tab_manual:checked ~ #oair_panel_manual,
    #oair_tab_gallery:checked ~ #oair_panel_gallery {
        display: block;
    }
```

- [ ] **Step 5: 从「优化」面板剪出「世界书注入」+「固定角色外貌（兜底）」两节**（settings_full.html 第 516-539 块），删除这两个 `<div class="oair-section">...</div>`（世界书注入节 + 固定角色外貌节），使 `#oair_panel_optimize` 内只剩 提示词优化 / NSFW / 消息总结。剪下的内容粘到 Step 6 的新面板里。

- [ ] **Step 6: 在 `#oair_panel_optimize` 的 `</div>`（第 572 行）之后、`<!-- TAB 5: 手动生图 -->` 之前插入新「世界书」面板**：
```html
    <!-- ═══════════════════════════════════════════════════════ -->
    <!-- TAB: 世界书                                            -->
    <!-- ═══════════════════════════════════════════════════════ -->
    <div class="oair-tab-panel" id="oair_panel_worldbook">
        <!-- 世界书注入 -->
        <div class="oair-section">
            <div class="oair-section-title">世界书注入 <span class="oair-badge oair-badge-green">自动读设定</span></div>
            <label class="oair-toggle-label">
                <input id="oair_worldbook_enabled" type="checkbox">
                从世界书自动读取人物外貌 / 固定场景设定
            </label>
            <div class="oair-hint">
                开启后：生图提示词里出现的角色名 / 地点名，会自动从「当前聊天 / 角色卡绑定的世界书」里命中条目并注入其相关段。<br>
                未覆盖到的角色再由下方「固定角色外貌」兜底。当前场景状态与动作仍由对话上下文决定。
            </div>
            <label class="oair-field-label">抽取的小节标题（逗号分隔，命中条目时只取这些段）</label>
            <input id="oair_worldbook_headings" class="text_pole" placeholder="外貌,长相,外观,appearance,场景,环境,setting,scene">
            <label class="oair-field-label">注入总字数上限</label>
            <input id="oair_worldbook_maxchars" class="text_pole" type="number" min="0" placeholder="800">
        </div>

        <!-- 固定角色外貌注入（兜底） -->
        <div class="oair-section">
            <div class="oair-section-title">固定角色外貌（兜底） <span class="oair-badge oair-badge-green">画对人</span></div>
            <label class="oair-field-label">角色外貌设定（每行一个角色，格式「名字：外貌描述」）</label>
            <textarea id="oair_character_appearance" class="text_pole" rows="5" style="width:100%; box-sizing:border-box;" placeholder="卡提希娅：金色长发，蓝色眼眸，尖耳，少女体型，前圣女气质，硬毛猪皮软甲，细带凉鞋，蓝色脚趾甲油&#10;齐齐：黑发青年，不死人，懒散的恶趣味神情"></textarea>
            <div class="oair-hint">兜底用：仅当上方「世界书注入」未覆盖到某角色时，才用这里的设定。格式「名字：外貌」，每行一个；留空则不注入。</div>
        </div>
    </div>
```

- [ ] **Step 7: 在文件末尾 `#oair_panel_manual` 的 `</div>`（第 623 行）之后、最外层 `</div>`（第 624 行）之前插入新「图库」面板**：
```html
    <!-- ═══════════════════════════════════════════════════════ -->
    <!-- TAB: 图库                                              -->
    <!-- ═══════════════════════════════════════════════════════ -->
    <div class="oair-tab-panel" id="oair_panel_gallery">
        <div class="oair-section">
            <div class="oair-gallery-toolbar">
                <div class="oair-section-title" style="margin:0;">图库 <span id="oair_gallery_count" class="oair-badge oair-badge-green">0 张</span></div>
                <div style="display:flex; gap:6px;">
                    <button id="oair_btn_gallery_refresh" class="menu_button">刷新</button>
                    <button id="oair_btn_gallery_clear" class="menu_button">清空图库</button>
                </div>
            </div>
            <div class="oair-hint">所有生成的图片自动保存到磁盘（SillyTavern/data/&lt;用户&gt;/user/images/&lt;角色&gt;/）并记录在此，刷新或重启都不会丢失。点击缩略图放大；「清空图库」只清除此处记录，不删除磁盘文件。</div>
            <div id="oair_gallery_grid" class="oair-gallery-grid" style="margin-top:8px;"></div>
        </div>
    </div>
```

- [ ] **Step 8: 更新 `index.js` tabMap（两处）**

`loadFullSettings`（第 192-198）与 `toggleFloatingPanel`（第 735-741），把两个 `tabMap` 对象都从 5 键改为 7 键：
```javascript
        const tabMap = {
            basic: "#oair_tab_basic",
            backend: "#oair_tab_backend",
            extract: "#oair_tab_extract",
            optimize: "#oair_tab_optimize",
            worldbook: "#oair_tab_worldbook",
            manual: "#oair_tab_manual",
            gallery: "#oair_tab_gallery",
        };
```
（注意缩进：loadFullSettings 内是 4 空格，toggleFloatingPanel 内是 8 空格——按各自上下文保持。）

- [ ] **Step 9: regen 内联 `SETTINGS_FULL_HTML`** — 用 Task 末尾「Regen 脚本」从 `settings_full.html` 重新生成 `index.js` 的常量行。

- [ ] **Step 10: 验证**
  - `node --check index.js` → 无错。
  - `grep -c "oair_tab_worldbook\|oair_tab_gallery" settings_full.html` ≥ 6（2 radio + 2 label + active 选择器 2 + show 选择器 2 中各含一次……实际逐字计数以 grep 为准）。
  - 内联同步：`grep -c "oair_panel_gallery" index.js` ≥ 2（一次 inline HTML，一次……至少 inline 含）；`grep -c "oair_panel_worldbook" index.js` ≥ 1。
  - `grep -c "worldbook:\|gallery:" index.js` → tabMap 两处各含两行 → 4。

---

## Task 3: 磁盘落盘 + 图库逻辑（index.js）

在唯一 choke point `requestImagesFromBackend()` 后置「落盘 + 记录图库」。所有入口（自动/手动/消息/总结）自动受益：聊天存短路径不再膨胀，图库记录全部生成图，手动预览清空也不丢图（已落盘+入库）。

**Files:** Modify `index.js`：import（第 16）、`requestImagesFromBackend`（第 1375-1381）、四个调用点传 source、`bindFloatingEvents` 接线（第 1048 前）、`loadFullSettings`（第 188 后）；新增 SECTION 17（文件末尾 `attachGeneratedImages` 之后）。

- [ ] **Step 1: import `saveBase64AsFile`**（第 16 行）

把：
```javascript
import { regexFromString } from "../../../utils.js";
```
改为：
```javascript
import { regexFromString, saveBase64AsFile } from "../../../utils.js";
```

- [ ] **Step 2: 新增 SECTION 17（落盘 + 图库），追加到文件末尾**（`attachGeneratedImages` 函数之后）：
```javascript

// ═══════════════════════════════════════════════════════════════
// SECTION 17: DISK PERSISTENCE & GALLERY
// ═══════════════════════════════════════════════════════════════

const GALLERY_KEY = `${extensionName}:gallery`;
const GALLERY_MAX = 100;

/** 是否为 data:image/...;base64,... 形式的内联图 */
function isDataUri(value) {
    return /^data:image\//i.test(String(value || ""));
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
async function persistAndRecordImages(images, prompt, source) {
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
        if (recordable && url) addGalleryRecord({ url, prompt, source });
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

function addGalleryRecord({ url, prompt, source }) {
    if (!url) return;
    const list = loadGallery();
    if (list.some((r) => r && r.url === url)) return;   // 路径去重
    list.unshift({
        url,
        prompt: String(prompt || "").slice(0, 500),
        source: source || "",
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
    saveGallery([]);
    refreshGalleryUi();
}

// ─── 图库 UI ──────────────────────────────────────────────────

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

    for (const rec of list) {
        if (!rec || !rec.url) continue;
        const cell = $('<div class="oair-gallery-cell"></div>');
        $("<img>")
            .attr("src", rec.url)
            .attr("title", rec.prompt || "")
            .attr("loading", "lazy")
            .on("click", () => openImageLightbox(rec.url))
            .appendTo(cell);

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
    updateMessageBlock(idx, msg, { rerenderMessage: false });
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
```

- [ ] **Step 3: 让 `requestImagesFromBackend` 后置落盘 + 记录**（第 1375-1381）

把：
```javascript
async function requestImagesFromBackend(prompt) {
    const settings = extension_settings[extensionName];
    if (settings.apiMode === "images") {
        return requestViaImagesGenerations(prompt);
    }
    return requestViaChatCompletions(prompt);
}
```
改为：
```javascript
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
        );
    }
    return result;
}
```

- [ ] **Step 4: 四个调用点补 source meta**
  - 第 1583（`onMessageReceived`）：`const result = await requestImagesFromBackend(prompt);` → `const result = await requestImagesFromBackend(prompt, { source: "auto" });`
  - 第 1648（`manualGenerate`）：`const result = await requestImagesFromBackend(prompt);` → `const result = await requestImagesFromBackend(prompt, { source: "manual" });`
  - 第 1842（`generateFromMessage`）：`const result = await requestImagesFromBackend(prompt);` → `const result = await requestImagesFromBackend(prompt, { source: "message" });`
  - 第 1899（`summarizeAndGenerate`）：`const result = await requestImagesFromBackend(sanitizedPrompt);` → `const result = await requestImagesFromBackend(sanitizedPrompt, { source: "summarize", prompt });`

- [ ] **Step 5: 接线图库按钮**（`bindFloatingEvents` 内，密码眼睛按钮 `}` 之后、函数结束 `}`（第 1048）之前插入）：
```javascript

    // ─── 图库 ──────────────────────────────────────────────
    fp.find("#oair_btn_gallery_refresh").off("click").on("click", (e) => {
        e.preventDefault();
        refreshGalleryUi();
    });
    fp.find("#oair_btn_gallery_clear").off("click").on("click", (e) => {
        e.preventDefault();
        if (confirm("清空整个图库记录？（磁盘上的图片文件不会被删除）")) {
            clearGallery();
            toastr.success("图库已清空");
        }
    });
```

- [ ] **Step 6: 面板加载时渲染一次图库**（`loadFullSettings`，第 188 `updateFloatingUi();` 之后加一行）

把：
```javascript
function loadFullSettings(body, html) {
    body.html(html);
    bindFloatingEvents();
    updateFloatingUi();
```
改为：
```javascript
function loadFullSettings(body, html) {
    body.html(html);
    bindFloatingEvents();
    updateFloatingUi();
    refreshGalleryUi();
```

- [ ] **Step 7: 验证**
  - `node --check index.js` → 无错。
  - 纯函数断言脚本（见下「Task 3 验证脚本」）：data-URI 解析、isDataUri、子目录清洗、图库 add/去重/封顶 全过。
  - `grep -n "saveBase64AsFile" index.js` → import 行 + persistImageToDisk 各一次。
  - `grep -c "requestImagesFromBackend(" index.js` → 1 定义 + 4 调用 = 5。

---

## Task 4: 视觉优化（主题色统一 + 标签栏滚动 + 区块强调）

**Files:** Modify `settings_full.html` 内联 `<style>` 与状态栏 `color:cyan`；然后 regen `SETTINGS_FULL_HTML`。

- [ ] **Step 1: 激活标签下划线改主题色**（Task 2 Step 3 改过的块，`border-bottom: 2px solid cyan;`）→ `border-bottom: 2px solid var(--SmartThemeQuoteColor, #68a0ff);`

- [ ] **Step 2: 状态栏文字色**（settings_full.html 第 272）`<div id="oair_floating_status" style="font-size:0.8em; color:cyan;">就绪</div>` → `color:var(--SmartThemeQuoteColor, #68a0ff);`

- [ ] **Step 3: 标签栏 7 个改横向滚动**（`.oair-tab-bar` 第 11-17）

把：
```css
    .oair-tab-bar {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid rgba(255,255,255,0.15);
        margin-bottom: 8px;
        flex-wrap: wrap;
    }
```
改为：
```css
    .oair-tab-bar {
        display: flex;
        gap: 2px;
        border-bottom: 1px solid rgba(255,255,255,0.15);
        margin-bottom: 8px;
        flex-wrap: nowrap;
        overflow-x: auto;
        scrollbar-width: thin;
    }
    .oair-tab-label { flex: 0 0 auto; }
```

- [ ] **Step 4: 区块左强调边 + 图库样式**（在内联 `<style>` 末尾、`</style>` 之前追加）：
```css
    /* ─── 区块左强调边（主题色） ─────────────────────────── */
    .oair-settings-ui .oair-section {
        border-left: 2px solid var(--SmartThemeQuoteColor, #68a0ff);
    }

    /* ─── 图库 ─────────────────────────────────────────── */
    .oair-gallery-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .oair-gallery-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
        gap: 8px;
    }
    .oair-gallery-cell {
        position: relative;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(0,0,0,0.2);
        aspect-ratio: 1 / 1;
    }
    .oair-gallery-cell img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        cursor: pointer;
        display: block;
    }
    .oair-gallery-cell-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        gap: 2px;
        padding: 2px;
        background: rgba(0,0,0,0.55);
        opacity: 0;
        transition: opacity 0.15s;
    }
    .oair-gallery-cell:hover .oair-gallery-cell-bar {
        opacity: 1;
    }
    .oair-gallery-mini {
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        line-height: 1;
    }
    /* 移动端无 hover：操作条常显 */
    @media (max-width: 1000px) {
        .oair-gallery-cell-bar { opacity: 0.9; }
    }
```

- [ ] **Step 5: regen `SETTINGS_FULL_HTML`**（Regen 脚本）。

- [ ] **Step 6: 验证** — `node --check index.js`；`grep -c "SmartThemeQuoteColor" settings_full.html` ≥ 3；`grep -c "oair-gallery-grid" index.js` ≥ 1（内联已含）。

---

## Task 5: 收尾（版本、部署、文档、最终验证）

- [ ] **Step 1: manifest 版本** `manifest.json` `"version": "1.8.0"` → `"1.9.0"`。

- [ ] **Step 2: CLAUDE.md** 在「Settings」「gotchas」补：磁盘落盘（`saveBase64AsFile`，choke point 在 `requestImagesFromBackend`，聊天存路径不内联 base64）、图库（localStorage 索引 `ST-OpenAI-Image-Relay:gallery`，仅存路径+提示词，封顶 100）、7 标签（新增 worldbook/gallery，tabMap 两处）、版本 1.9.0。

- [ ] **Step 3: 部署同步** 整目录覆盖 `E:\AI\SillyTavern\public\scripts\extensions\third-party\ST-OpenAI-Image-Relay-PlanC\`（至少 index.js / settings_full.html / style.css / manifest.json）。

- [ ] **Step 4: 最终静态验证** `node --check index.js`；`git diff --stat`；grep 无残留 5-键 tabMap、无 `color:cyan`、无 `border-bottom: 2px solid cyan`。

- [ ] **Step 5: 浏览器手测清单**（用户在 localhost:8258 执行）
  1. 硬刷新，开悬浮窗 → 看到 7 个标签，点击逐个可切换；世界书 tab 含两节，优化 tab 不再有它们。
  2. 手机端（或 DevTools 设备模拟）拖动标题栏 → 顺畅移动。
  3. 手动 tab 生成一张图 → 图库 tab 出现该图；清空预览后图仍在图库。
  4. 图库点图放大；📎 附加到消息成功；⬇️ 下载成功；🗑️ 删除记录后消失。
  5. 自动/消息生图各一次 → 图库累计；查看聊天 `.jsonl`，`extra.media[].url` 是 `user/images/...` 路径而非 base64。
  6. 磁盘确认 `E:\AI\SillyTavern\data\default-user\user\images\<角色>\oair_*.png` 有文件。
  7. DevTools console 无 `[ST-OpenAI-Image-Relay]` 报错。

---

## Regen 脚本（Task 2/4 复用）

把 `settings_full.html` 重新序列化进 `index.js` 的 `SETTINGS_FULL_HTML` 常量（单行、非 ASCII 转 `\uXXXX`，与现有风格一致）。存为 `tmp_regen.mjs`，`node tmp_regen.mjs` 运行，完后删除：
```javascript
import fs from "fs";
const html = fs.readFileSync("settings_full.html", "utf8");
const lit = '"' + html
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    + '"';
let idx = fs.readFileSync("index.js", "utf8");
const re = /^const SETTINGS_FULL_HTML = ".*";$/m;
if (!re.test(idx)) throw new Error("找不到 SETTINGS_FULL_HTML 常量行");
idx = idx.replace(re, `const SETTINGS_FULL_HTML = ${lit};`);
fs.writeFileSync("index.js", idx);
console.log("SETTINGS_FULL_HTML 已重新生成，长度", lit.length);
```

## Task 3 验证脚本（纯函数断言）

存为 `tmp_test.mjs`，`node tmp_test.mjs`，完后删除：
```javascript
import assert from "assert";

function isDataUri(value) { return /^data:image\//i.test(String(value || "")); }
function subClean(name) { return (String(name).trim().replace(/[\\/:*?"<>|]+/g, "_")) || "FALLBACK"; }
function parseDataUri(image) {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/is.exec(String(image || ""));
    if (!m) return null;
    return { ext: String(m[1] || "png").toLowerCase(), b64: m[2] };
}
// 图库纯逻辑（用普通数组模拟 localStorage）
const MAX = 100;
function addRec(list, rec) {
    if (!rec.url) return list;
    if (list.some((r) => r.url === rec.url)) return list;
    list.unshift({ url: rec.url, prompt: String(rec.prompt || "").slice(0, 500), source: rec.source || "", ts: 0 });
    if (list.length > MAX) list.length = MAX;
    return list;
}

// isDataUri
assert.equal(isDataUri("data:image/png;base64,AAAA"), true);
assert.equal(isDataUri("https://x/y.png"), false);
assert.equal(isDataUri("user/images/a/b.png"), false);
assert.equal(isDataUri(""), false);

// parseDataUri
assert.deepEqual(parseDataUri("data:image/png;base64,QUJD"), { ext: "png", b64: "QUJD" });
assert.deepEqual(parseDataUri("data:image/JPEG;base64,QQ=="), { ext: "jpeg", b64: "QQ==" });
assert.equal(parseDataUri("https://x/y.png"), null);

// subClean
assert.equal(subClean("  夏目  "), "夏目");
assert.equal(subClean('a/b:c*?"<>|d'), "a_b_c_d");
assert.equal(subClean(""), "FALLBACK");

// gallery add + dedupe + cap
let g = [];
g = addRec(g, { url: "p1", prompt: "x" });
g = addRec(g, { url: "p1", prompt: "x" });           // 重复
assert.equal(g.length, 1);
g = addRec(g, { url: "p2", prompt: "y" });
assert.equal(g[0].url, "p2");                          // 最新在前
for (let i = 0; i < 200; i++) g = addRec(g, { url: "u" + i, prompt: "" });
assert.equal(g.length, MAX);                           // 封顶 100
assert.equal(g[0].url, "u199");

// prompt 截断 500
g = addRec([], { url: "long", prompt: "z".repeat(900) });
assert.equal(g[0].prompt.length, 500);

console.log("ALL PASS");
```

---

## Self-Review

- **覆盖：** ① 预览丢图 → 落盘+图库（Task 3）自动解决；② 加标签 → 世界书+图库（Task 2）；③ 手机拖动 → touch-action（Task 1）；④ 视觉 → Task 4；磁盘持久化 → Task 3。✓
- **占位符：** 无 TBD；新函数均给出完整代码。
- **类型/命名一致：** `refreshGalleryUi`/`addGalleryRecord`/`persistAndRecordImages`/`persistImageToDisk`/`isDataUri`/`currentGallerySubFolder`/`attachGalleryImageToMessage`/`downloadImage`/`loadGallery`/`saveGallery`/`deleteGalleryRecord`/`clearGallery` 全在 SECTION 17 定义并被引用；`requestImagesFromBackend(prompt, meta)` 与 4 调用点一致。
- **双副本：** 每次改 `settings_full.html` 都 regen `SETTINGS_FULL_HTML`；header 样式只在 style.css。
- **风险：** 落盘依赖 ST 后端（页面本就由它服务，恒可用）；失败静默回退。`requestImagesFromBackend` 改动影响全部入口——这是预期（治膨胀），老聊天内联 base64 仍可渲染。
