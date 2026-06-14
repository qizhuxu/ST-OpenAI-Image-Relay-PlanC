# 世界书注入（World Book Injection）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让生图提示词的"人物外貌 + 固定场景设定"从 SillyTavern 世界书按关键词命中自动注入，手动 `characterAppearance` 降级为兜底。

**Architecture:** 在现有提示词流水线 Step 3（`optimize → sanitize → 注入`）把同步的 `injectCharacterAppearance` 换成异步编排器 `injectStableDescriptions`。编排器读取当前激活世界书的条目，凡 `key`（≥2字）命中提示词即抽取其"相关段"注入，并记录已覆盖实体；手动外貌只补世界书未覆盖的角色；统一去重并按总字数封顶。全程优雅降级（无 API / 无书 / 加载失败 → 退回手动）。

**Tech Stack:** 原生 ES module（无框架/无构建/无测试框架）；jQuery、`getContext()`（含 `loadWorldInfo`）、SillyTavern 全局；验证用一次性 Node `.mjs` 断言脚本。

---

## ⚠️ 执行前必读（本项目特例，覆盖技能默认）

1. **无测试框架**：本项目无 `package.json`/pytest/jest。"测试"= 把纯函数原样拷进一次性 `tmp_*.mjs` 脚本写断言、`node` 跑、跑完删。这是本项目（spec §10）确认的验证方式，**不要**引入测试框架。ST 耦合函数（`loadWorldInfo`/UI）只能浏览器内手测。
2. **提交受控**：本会话用户要求"未经明确同意不提交 git"。每个任务末尾的 `git commit` 步骤视为**逻辑检查点**——可 `git add` 暂存，但**实际 `git commit` 等用户放行后统一执行**。
3. **UI 双份同步铁律**：`settings_full.html`（外部）与 index.js 内联 `SETTINGS_FULL_HTML` 常量必须同步（Task 8 改外部、Task 9 重生成内联）。
4. **语言**：注释/UI/状态串一律中文。DOM id 前缀 `oair_`，class 前缀 `oair-`。
5. 关联 spec：`docs/superpowers/specs/2026-06-07-worldbook-injection-design.md`。

## 文件结构

| 文件 | 职责 | 改动 |
|---|---|---|
| `index.js` | 全部逻辑 + 内联 HTML + 绑定 | 设置 +3 key；SECTION 15 新增 4 函数 + 缓存 + 重构；流水线 2 处接入；`CHAT_CHANGED`；绑定/同步 +3；内联 `SETTINGS_FULL_HTML` 重生成 |
| `settings_full.html` | L2 浮窗 UI（外部主用） | 「优化」tab 新增"世界书"小节 + 改"固定角色外貌"文案 |
| `CLAUDE.md` | 给后续 Claude 的指南 | 流水线/设置说明补世界书路（Task 10） |
| `manifest.json` | 版本号 | bump（Task 10） |
| `tmp_*.mjs` | 一次性验证脚本 | 各任务内创建/运行/删除 |

新增标识符（全程一致）：函数 `extractEntrySection` / `collectManualAppearances` / `getActiveWorldBookNames` / `loadActiveWorldBookEntries` / `clearWorldBookCache` / `injectStableDescriptions`；模块级 `worldBookCache`；设置 `worldBookEnabled` / `worldBookSectionHeadings` / `worldBookMaxChars`；DOM id `oair_worldbook_enabled` / `oair_worldbook_headings` / `oair_worldbook_maxchars`。

---

## Task 1: 新增 3 个设置项

**Files:**
- Modify: `index.js`（`defaultSettings`，紧接 `characterAppearance: "",` 之后，约 152 行）

- [ ] **Step 1: 在 `defaultSettings` 加 3 个 key**

在 `characterAppearance: "",` 那一行**下面**插入：

```javascript
    // 世界书注入：从当前激活世界书按关键词命中注入人物外貌/固定场景设定（characterAppearance 作兜底）
    worldBookEnabled: false,
    worldBookSectionHeadings: "外貌,长相,外观,appearance,场景,环境,setting,scene",
    worldBookMaxChars: 800,
```

- [ ] **Step 2: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 3: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add worldBook settings keys"   # 待用户授权
```

---

## Task 2: `extractEntrySection`（纯函数，抽相关段）

**Files:**
- Modify: `index.js`（SECTION 15，紧接 `injectCharacterAppearance` 之后，约 2429 行）
- Test: `tmp_extract_test.mjs`（临时）

- [ ] **Step 1: 实现 `extractEntrySection`**

在 `injectCharacterAppearance` 函数闭合 `}` 之后插入：

```javascript
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
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_extract_test.mjs`（把上面的函数原样拷入 + 断言）：

```javascript
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
                if (!lines[j].trim()) break;
                if (headingLabel(lines[j])) break;
                buf.push(lines[j].trim());
            }
            const body = buf.join(" ").trim();
            if (body) return `${label}：${body}`.slice(0, MAX);
        }
    }
    return text.trim().slice(0, MAX);
}

const H = ["外貌", "appearance", "场景"];
let pass = 0, fail = 0;
const eq = (name, got, exp) => {
    if (got === exp) { pass++; }
    else { fail++; console.log(`FAIL ${name}\n  got: ${JSON.stringify(got)}\n  exp: ${JSON.stringify(exp)}`); }
};

// 1) 命中外貌段，止于下一个小节标题
eq("hit-appearance",
   extractEntrySection("姓名：卡提希娅\n外貌：金发蓝瞳，尖耳\n性格：高傲", H),
   "外貌：金发蓝瞳，尖耳");
// 2) 段跨多行，止于空行
eq("multiline",
   extractEntrySection("外貌：金发\n蓝瞳\n\n性格：高傲", H),
   "外貌：金发 蓝瞳");
// 3) 英文标题 + 冒号
eq("english",
   extractEntrySection("appearance: blonde hair\nrole: knight", H),
   "appearance：blonde hair");
// 4) 无任何标题 → 整条
eq("no-heading",
   extractEntrySection("一个安静的图书馆，烛光摇曳", H),
   "一个安静的图书馆，烛光摇曳");
// 5) 空内容 → 空串
eq("empty", extractEntrySection("", H), "");
// 6) 截断到 300 字
eq("cap300", extractEntrySection("外貌：" + "金".repeat(400), H).length, 300);

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_extract_test.mjs`
Expected: 末行 `ALL PASS (pass=6, fail=0)`。若 HAS FAIL：同步修正 index.js 与脚本里的函数，重跑。

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_extract_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add extractEntrySection"   # 待用户授权
```

---

## Task 3: `collectManualAppearances`（从 `injectCharacterAppearance` 抽出，支持 covered）

**Files:**
- Modify: `index.js`（SECTION 15，紧接 `extractEntrySection` 之后）
- Test: `tmp_manual_test.mjs`（临时）

- [ ] **Step 1: 实现 `collectManualAppearances`**

在 `extractEntrySection` 之后插入：

```javascript
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
```

- [ ] **Step 2: 写验证脚本**

创建 `tmp_manual_test.mjs`（拷入函数 + 断言）：

```javascript
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

let pass = 0, fail = 0;
const eqJson = (name, got, exp) => {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got: ${g}\n  exp: ${e}`); }
};
const A = "卡提希娅：金发蓝瞳\n齐齐：黑发青年";

// 1) 只收出现在 prompt 中的角色
eqJson("present-only",
    collectManualAppearances("卡提希娅站在门口", A),
    [{ name: "卡提希娅", text: "卡提希娅：金发蓝瞳" }]);
// 2) covered 命中 → 跳过
eqJson("covered-skip",
    collectManualAppearances("卡提希娅站在门口", A, new Set(["卡提希娅"])),
    []);
// 3) 无「名字：」格式 → 整体一条
eqJson("freeform",
    collectManualAppearances("任意提示词", "厚涂风格，暖色调"),
    [{ name: "", text: "厚涂风格，暖色调" }]);
// 4) 空设定 → 空数组
eqJson("empty", collectManualAppearances("x", ""), []);

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_manual_test.mjs`
Expected: 末行 `ALL PASS (pass=4, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_manual_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add collectManualAppearances"   # 待用户授权
```

---

## Task 4: `getActiveWorldBookNames`（防御式读取激活书名）

**Files:**
- Modify: `index.js`（SECTION 15，紧接 `collectManualAppearances` 之后）
- Test: `tmp_names_test.mjs`（临时）

- [ ] **Step 1: 实现 `getActiveWorldBookNames`**

```javascript
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
```

- [ ] **Step 2: 写验证脚本**（用本地 stub 替 `getContext`/`dedupeStrings`）

创建 `tmp_names_test.mjs`：

```javascript
const extensionName = "TEST";
function dedupeStrings(values) { return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))]; }
let _ctx = {};
function getContext() { return _ctx; }

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
    } catch (e) { console.warn(`[${extensionName}] getActiveWorldBookNames failed`, e); }
    return dedupeStrings(names.filter((n) => typeof n === "string" && n.trim()));
}

let pass = 0, fail = 0;
const eqJson = (name, got, exp) => {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got: ${g}\n  exp: ${e}`); }
};

// 1) 聊天书 + 角色书，去重
_ctx = { chatMetadata: { world_info: "世界书A" }, characterId: 3, characters: { 3: { data: { extensions: { world: "世界书B" } } } } };
eqJson("chat+char", getActiveWorldBookNames(), ["世界书A", "世界书B"]);
// 2) 同名去重
_ctx = { chatMetadata: { world_info: "同一本" }, characterId: 0, characters: { 0: { data: { extensions: { world: "同一本" } } } } };
eqJson("dedupe", getActiveWorldBookNames(), ["同一本"]);
// 3) 全缺失 → 空
_ctx = {};
eqJson("empty", getActiveWorldBookNames(), []);
// 4) 聊天书为数组
_ctx = { chatMetadata: { world_info: ["X", "Y"] } };
eqJson("array", getActiveWorldBookNames(), ["X", "Y"]);

console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_names_test.mjs`
Expected: 末行 `ALL PASS (pass=4, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_names_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add getActiveWorldBookNames"   # 待用户授权
```

---

## Task 5: `loadActiveWorldBookEntries` + `clearWorldBookCache`（异步加载 + 缓存）

**Files:**
- Modify: `index.js`（SECTION 15，紧接 `getActiveWorldBookNames` 之后）
- Test: `tmp_load_test.mjs`（临时）

- [ ] **Step 1: 实现加载与缓存**

```javascript
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
```

- [ ] **Step 2: 写验证脚本**（stub `getContext().loadWorldInfo`）

创建 `tmp_load_test.mjs`：

```javascript
const extensionName = "TEST";
function dedupeStrings(values) { return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))]; }
let _ctx = {};
function getContext() { return _ctx; }
function getActiveWorldBookNames() {
    const names = [];
    const chatBook = _ctx?.chatMetadata?.world_info;
    if (typeof chatBook === "string") names.push(chatBook);
    return dedupeStrings(names);
}
let worldBookCache = { sig: null, entries: null };
function clearWorldBookCache() { worldBookCache = { sig: null, entries: null }; }
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
        } catch (err) { console.warn(err); }
    }
    worldBookCache = { sig, entries: all };
    return all;
}

let pass = 0, fail = 0, loadCalls = 0;
const eqJson = (name, got, exp) => {
    const g = JSON.stringify(got), e = JSON.stringify(exp);
    if (g === e) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got: ${g}\n  exp: ${e}`); }
};

_ctx = {
    chatMetadata: { world_info: "BookA" },
    loadWorldInfo: async () => { loadCalls++; return { entries: {
        0: { key: ["卡提希娅"], keysecondary: [], content: "外貌：金发", comment: "卡提希娅", disable: false },
        1: { key: ["禁用"], content: "x", disable: true },         // 被滤
        2: { key: ["我"], content: "短key" },                       // key<2 被滤
        3: { key: ["图书馆"], content: "" },                        // 空内容被滤
    } }; },
};

(async () => {
    clearWorldBookCache();
    const r1 = await loadActiveWorldBookEntries();
    eqJson("filter", r1, [{ keys: ["卡提希娅"], content: "外貌：金发", comment: "卡提希娅" }]);
    // 缓存命中：第二次不再调 loadWorldInfo
    const before = loadCalls;
    await loadActiveWorldBookEntries();
    eqJson("cache-hit", loadCalls, before);
    // 无 loadWorldInfo（老版 ST）→ []
    _ctx = { chatMetadata: { world_info: "BookA" } };
    clearWorldBookCache();
    eqJson("no-api", await loadActiveWorldBookEntries(), []);
    console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
})();
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_load_test.mjs`
Expected: 末行 `ALL PASS (pass=3, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_load_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add loadActiveWorldBookEntries + cache"   # 待用户授权
```

---

## Task 6: `injectStableDescriptions`（异步编排器，核心）

**Files:**
- Modify: `index.js`（SECTION 15，紧接 `loadActiveWorldBookEntries` 之后）
- Test: `tmp_inject_test.mjs`（临时）

- [ ] **Step 1: 实现 `injectStableDescriptions`**

```javascript
/**
 * 稳定设定注入编排器（流水线 Step 3）：世界书命中 → 抽相关段 + 记录 covered；
 * 手动外貌补 covered 之外；去重、按 worldBookMaxChars 累加封顶；追加【设定参考】块。
 */
async function injectStableDescriptions(prompt, settings) {
    const base = String(prompt || "");
    const collected = [];   // [{name, text}]
    const covered = new Set();

    if (settings.worldBookEnabled) {
        try {
            const entries = await loadActiveWorldBookEntries();
            const headings = String(settings.worldBookSectionHeadings || "")
                .split(/[,，]/).map((h) => h.trim()).filter(Boolean);
            for (const e of entries) {
                const hitKey = e.keys.find((k) => base.includes(k));
                if (!hitKey) continue;
                const section = extractEntrySection(e.content, headings);
                if (!section) continue;
                collected.push({ name: e.comment || hitKey, text: section });
                e.keys.forEach((k) => covered.add(k));
                if (e.comment) covered.add(e.comment);
            }
        } catch (err) {
            console.warn(`[${extensionName}] world book injection failed`, err);
        }
    }

    collected.push(...collectManualAppearances(base, settings.characterAppearance, covered));
    if (!collected.length) return base;

    const maxChars = Number(settings.worldBookMaxChars) || 800;
    const seen = new Set();
    const picked = [];
    let total = 0;
    for (const item of collected) {
        const t = String(item.text || "").trim();
        if (!t || seen.has(t)) continue;
        if (total + t.length > maxChars) break;
        seen.add(t);
        picked.push(t);
        total += t.length;
    }
    if (!picked.length) return base;
    return `${base}\n\n【设定参考】\n${picked.join("\n")}`;
}
```

- [ ] **Step 2: 写验证脚本**（stub 掉 `loadActiveWorldBookEntries`，真用 `extractEntrySection`/`collectManualAppearances`）

创建 `tmp_inject_test.mjs`：

```javascript
const extensionName = "TEST";
// --- 真实依赖（与 index.js 同源拷贝）---
function extractEntrySection(content, headings) {
    const text = String(content || ""); if (!text.trim()) return ""; const MAX = 300;
    const heads = (Array.isArray(headings) ? headings : []).map((h) => String(h || "").trim().toLowerCase()).filter(Boolean);
    const lines = text.split(/\r?\n/);
    const headingLabel = (line) => { const m = line.match(/^\s*([^\n：:]{1,16})\s*[:：]/); return m ? m[1].trim() : null; };
    for (let i = 0; i < lines.length; i++) {
        const label = headingLabel(lines[i]);
        if (label && heads.includes(label.toLowerCase())) {
            const after = lines[i].replace(/^\s*[^\n：:]{1,16}\s*[:：]\s*/, "").trim();
            const buf = []; if (after) buf.push(after);
            for (let j = i + 1; j < lines.length; j++) { if (!lines[j].trim()) break; if (headingLabel(lines[j])) break; buf.push(lines[j].trim()); }
            const body = buf.join(" ").trim(); if (body) return `${label}：${body}`.slice(0, MAX);
        }
    }
    return text.trim().slice(0, MAX);
}
function collectManualAppearances(prompt, appearanceText, covered = new Set()) {
    const base = String(prompt || ""); const raw = String(appearanceText || "").trim(); if (!raw) return [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); const out = []; let parsedAny = false;
    for (const line of lines) { const m = line.match(/^([^：:]{1,24})[：:]\s*(.+)$/); if (m) { parsedAny = true; const name = m[1].trim(); if (covered.has(name)) continue; if (base.includes(name)) out.push({ name, text: line }); } }
    if (!parsedAny) out.push({ name: "", text: raw }); return out;
}
// --- stub ---
let _entries = [];
async function loadActiveWorldBookEntries() { return _entries; }
// --- 被测函数 ---
async function injectStableDescriptions(prompt, settings) {
    const base = String(prompt || ""); const collected = []; const covered = new Set();
    if (settings.worldBookEnabled) {
        try {
            const entries = await loadActiveWorldBookEntries();
            const headings = String(settings.worldBookSectionHeadings || "").split(/[,，]/).map((h) => h.trim()).filter(Boolean);
            for (const e of entries) {
                const hitKey = e.keys.find((k) => base.includes(k)); if (!hitKey) continue;
                const section = extractEntrySection(e.content, headings); if (!section) continue;
                collected.push({ name: e.comment || hitKey, text: section });
                e.keys.forEach((k) => covered.add(k)); if (e.comment) covered.add(e.comment);
            }
        } catch (err) { console.warn(err); }
    }
    collected.push(...collectManualAppearances(base, settings.characterAppearance, covered));
    if (!collected.length) return base;
    const maxChars = Number(settings.worldBookMaxChars) || 800; const seen = new Set(); const picked = []; let total = 0;
    for (const item of collected) { const t = String(item.text || "").trim(); if (!t || seen.has(t)) continue; if (total + t.length > maxChars) break; seen.add(t); picked.push(t); total += t.length; }
    if (!picked.length) return base; return `${base}\n\n【设定参考】\n${picked.join("\n")}`;
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };
const S = (over) => ({ worldBookEnabled: true, worldBookSectionHeadings: "外貌,场景", worldBookMaxChars: 800, characterAppearance: "", ...over });

(async () => {
    // 1) 世界书命中 → 注入外貌段
    _entries = [{ keys: ["卡提希娅"], content: "外貌：金发蓝瞳\n性格：高傲", comment: "卡提希娅" }];
    let r = await injectStableDescriptions("卡提希娅微笑", S());
    ok("wb-hit", r.includes("【设定参考】") && r.includes("外貌：金发蓝瞳") && !r.includes("性格"));

    // 2) 世界书已覆盖 → 手动不重复
    r = await injectStableDescriptions("卡提希娅微笑", S({ characterAppearance: "卡提希娅：手动描述" }));
    ok("manual-covered", !r.includes("手动描述"));

    // 3) 世界书未覆盖的角色 → 手动兜底
    _entries = [];
    r = await injectStableDescriptions("齐齐出场", S({ characterAppearance: "齐齐：黑发青年" }));
    ok("manual-fallback", r.includes("齐齐：黑发青年"));

    // 4) 关闭世界书 → 只走手动
    r = await injectStableDescriptions("齐齐出场", S({ worldBookEnabled: false, characterAppearance: "齐齐：黑发青年" }));
    ok("wb-off", r.includes("齐齐：黑发青年"));

    // 5) 无命中、无手动 → 原样返回
    r = await injectStableDescriptions("纯风景", S());
    ok("no-op", r === "纯风景");

    // 6) 总长封顶：maxChars=10 时不超量追加
    _entries = [{ keys: ["甲"], content: "外貌：" + "金".repeat(50), comment: "甲" }];
    r = await injectStableDescriptions("甲", S({ worldBookMaxChars: 10 }));
    ok("cap-total", !r.includes("【设定参考】"));   // 单条 53 字 > 10，break 后 picked 为空

    console.log(`\n${fail === 0 ? "ALL PASS" : "HAS FAIL"} (pass=${pass}, fail=${fail})`);
})();
```

- [ ] **Step 3: 运行验证**

Run: `node tmp_inject_test.mjs`
Expected: 末行 `ALL PASS (pass=6, fail=0)`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_inject_test.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): add injectStableDescriptions orchestrator"   # 待用户授权
```

---

## Task 7: 接入流水线 + 退役 `injectCharacterAppearance` + 缓存清理

**Files:**
- Modify: `index.js`（`processPromptPipeline` ~1350；`summarizeAndGenerate` ~1885；`CHAT_CHANGED` 处理器 ~236；删 `injectCharacterAppearance` ~2403-2429）

- [ ] **Step 1: `processPromptPipeline` Step 3 改为 await 编排器**

把（约 1350 行）：
```javascript
    prompt = injectCharacterAppearance(prompt, settings.characterAppearance);
```
改为：
```javascript
    prompt = await injectStableDescriptions(prompt, settings);
```

- [ ] **Step 2: `summarizeAndGenerate` 改为 await 编排器**

把（约 1885 行）：
```javascript
        sanitizedPrompt = injectCharacterAppearance(sanitizedPrompt, settings.characterAppearance);
```
改为：
```javascript
        sanitizedPrompt = await injectStableDescriptions(sanitizedPrompt, settings);
```

- [ ] **Step 3: `CHAT_CHANGED` 处理器清世界书缓存**

把（约 236 行）：
```javascript
        eventSource.on(event_types.CHAT_CHANGED, () => {
            inFlightMessages.clear();
        });
```
改为：
```javascript
        eventSource.on(event_types.CHAT_CHANGED, () => {
            inFlightMessages.clear();
            clearWorldBookCache();
        });
```

- [ ] **Step 4: 删除已退役的 `injectCharacterAppearance`**

删掉整个 `injectCharacterAppearance` 函数（含其上方 JSDoc 注释块，约 2399-2429 行）。其逻辑已由 `collectManualAppearances` 取代。

- [ ] **Step 5: 确认无残留引用**

Run: `grep -n "injectCharacterAppearance" index.js`
Expected: **无输出**（若仍有，说明 Step 1/2/4 漏改，补上）。

- [ ] **Step 6: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 7: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "feat(worldbook): wire injectStableDescriptions into pipeline, retire injectCharacterAppearance"   # 待用户授权
```

---

## Task 8: UI —「世界书」小节 + 绑定 + 值同步（外部 HTML）

**Files:**
- Modify: `settings_full.html`（「优化」tab，`固定角色外貌` 小节 516-522 处）
- Modify: `index.js`（`bindSettingInput` 区 ~808；`updateFloatingUi` 值同步区 ~1117）

- [ ] **Step 1: 在 `settings_full.html` 插入"世界书"小节**

在 `<!-- 固定角色外貌注入 -->` 那个 `<div class="oair-section">`（516 行）**之前**插入：

```html
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

```

- [ ] **Step 2: 改"固定角色外貌"小节文案为"兜底"**

把 518 行：
```html
            <div class="oair-section-title">固定角色外貌注入 <span class="oair-badge oair-badge-green">画对人</span></div>
```
改为：
```html
            <div class="oair-section-title">固定角色外貌（兜底） <span class="oair-badge oair-badge-green">画对人</span></div>
```

把 521 行的提示文案改为：
```html
            <div class="oair-hint">兜底用：仅当上方「世界书注入」未覆盖到某角色时，才用这里的设定。格式「名字：外貌」，每行一个；留空则不注入。</div>
```

- [ ] **Step 3: 在 `bindSettingInput` 区加 3 个绑定**

在（约 808 行）`bindSettingInput("#oair_character_appearance", ...)` 那一行**之后**插入：

```javascript
    bindSettingInput("#oair_worldbook_enabled", "worldBookEnabled", () => fp.find("#oair_worldbook_enabled").prop("checked"));
    bindSettingInput("#oair_worldbook_headings", "worldBookSectionHeadings", () => fp.find("#oair_worldbook_headings").val());
    bindSettingInput("#oair_worldbook_maxchars", "worldBookMaxChars", () => Number(fp.find("#oair_worldbook_maxchars").val()) || 0);
```

- [ ] **Step 4: 在 `updateFloatingUi` 值同步区加 3 行**

在（约 1117 行）`fp.find("#oair_character_appearance").val(...)` 那一行**之后**插入：

```javascript
    fp.find("#oair_worldbook_enabled").prop("checked", !!s.worldBookEnabled);
    fp.find("#oair_worldbook_headings").val(s.worldBookSectionHeadings || "");
    fp.find("#oair_worldbook_maxchars").val(s.worldBookMaxChars ?? 800);
```

- [ ] **Step 5: 语法校验**

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 6: 检查点（暂存；提交待授权）**

```bash
git add index.js settings_full.html
# git commit -m "feat(worldbook): add world book UI section + bindings"   # 待用户授权
```

---

## Task 9: 同步内联 `SETTINGS_FULL_HTML` 常量（铁律：双份一致）

**Files:**
- Modify: `index.js`（内联 `SETTINGS_FULL_HTML` 常量，约 174 行那一长行）
- 工具: `tmp_regen.mjs`（临时）

- [ ] **Step 1: 写重生成脚本**

创建 `tmp_regen.mjs`（读更新后的 `settings_full.html` → 生成 JS 字符串字面量、非 ASCII 转 `\uXXXX` → 替换 index.js 里的常量行）：

```javascript
import fs from "node:fs";
const html = fs.readFileSync("settings_full.html", "utf8");
// JSON.stringify 处理引号/换行；再把 >127 的字符逐个转 \uXXXX（纯 ASCII 源，避免被工具改写）
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

- [ ] **Step 3: 校验内联常量含新控件 + 语法**

Run: `grep -c "oair_worldbook_enabled" index.js`
Expected: `2`（外部已删？不——index.js 只含内联那份 + 绑定代码；应为 `2`：绑定区 1 次 + 内联 HTML 1 次。若 Step 3/4 of Task 8 也在 index.js，则计数可能为 3，确认 ≥2 即可）

Run: `cp index.js tmp_syntax.mjs && node --check tmp_syntax.mjs && echo OK && rm -f tmp_syntax.mjs`
Expected: 打印 `OK`

- [ ] **Step 4: 删除临时脚本**

Run: `rm -f tmp_regen.mjs`

- [ ] **Step 5: 检查点（暂存；提交待授权）**

```bash
git add index.js
# git commit -m "chore(worldbook): regenerate inline SETTINGS_FULL_HTML"   # 待用户授权
```

---

## Task 10: 收尾 — manifest 版本、CLAUDE.md、浏览器手测

**Files:**
- Modify: `manifest.json`（`version`）
- Modify: `CLAUDE.md`（流水线/设置说明）

- [ ] **Step 1: bump manifest 版本**

把 `manifest.json` 的 `"version": "1.7.0"` 改为 `"version": "1.8.0"`。

- [ ] **Step 2: 更新 CLAUDE.md**

在「Core data flow」Step 3 把 `injectCharacterAppearance` 替换为 `injectStableDescriptions`（世界书命中注入 + 手动兜底）；在「Settings」补 `worldBookEnabled/worldBookSectionHeadings/worldBookMaxChars`；在「Conventions & gotchas」补一条：世界书读取经 `getContext().loadWorldInfo`，按 `key` 命中提示词注入相关段，缓存在 `CHAT_CHANGED` 清；老版 ST 无 `loadWorldInfo` 时静默降级到手动兜底。

- [ ] **Step 3: 浏览器内手测（人工，必须）**

1. 同步本目录到 `SillyTavern/public/scripts/extensions/third-party/<folder>/`，硬刷新。
2. 准备：给当前聊天绑定一本世界书，建一条条目：关键词填角色名（如「卡提希娅」），内容含一行 `外貌：金色长发，蓝色眼眸`，再加几行 `性格：…`。
3. L2 浮窗「优化」tab → 打开「世界书注入」开关。
4. 触发一次生图（自动 `<pic>` / 手动 / 消息按钮均可），DevTools 控制台看 `[ST-OpenAI-Image-Relay]` 无报错。
5. **验证**：发往后端的提示词末尾出现 `【设定参考】` 且**只含**`外貌：…`段（不含`性格`）。可在 `requestImagesFromBackend` 前 `console.log` 或看网络请求体。
6. **兜底**：关掉世界书开关、在「固定角色外貌」填 `卡提希娅：测试兜底`，再生图 → 应注入兜底文本。
7. **降级**：解绑世界书 / 换一个没绑书的聊天 → 不报错，仅手动兜底（或无注入）。
8. **覆盖去重**：世界书与手动都写了「卡提希娅」→ 最终只出现世界书那条，手动不重复。

- [ ] **Step 4: 检查点（暂存；提交待授权）**

```bash
git add manifest.json CLAUDE.md
# git commit -m "docs(worldbook): bump version, update CLAUDE.md"   # 待用户授权
```

---

## 自检（Self-Review）

**Spec 覆盖**：
- §4.1 三设置 → Task 1 ✓
- §4.2 `getActiveWorldBookNames`/`loadActiveWorldBookEntries`/`extractEntrySection`/`injectStableDescriptions` → Task 4/5/2/6 ✓
- §4.2 复用手动解析（`collectManualAppearances`）→ Task 3 ✓
- §4.3 流水线接入 + summarize + CHAT_CHANGED → Task 7 ✓
- §6 WI 优先/手动兜底（covered）→ Task 6（逻辑）+ tmp_inject_test 用例 2/3 ✓
- §7 UI（双份同步 + 绑定）→ Task 8 + 9 ✓
- §8 边界降级（无 API/无书/加载失败/短 key/封顶）→ Task 5（no-api、短key）+ Task 6（封顶、no-op）✓
- §9 取数路径（chat + character，全局选中本期不做）→ Task 4 ✓（防御式，缺字段即降级）
- §10 验证方式（Node 断言 + node --check + 浏览器手测）→ 各任务 ✓
- §11 涉及文件 → 全覆盖 ✓

**占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码、每个验证步骤含可跑命令与预期输出。✓

**类型/命名一致性**：`injectStableDescriptions(prompt, settings)`、`loadActiveWorldBookEntries()`、`extractEntrySection(content, headings)`、`collectManualAppearances(prompt, appearanceText, covered)`、`worldBookCache`、设置 key、DOM id —— 跨 Task 2-9 拼写一致。✓

**已知偏差（有意）**：strict 失败优先 TDD 不适用（无 runner），改用"实现→拷入 tmp 脚本断言→跑绿"；commit 步骤受本会话授权门控。
