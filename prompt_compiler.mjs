const PROMPT_SAFETY_LEVELS = ["strict", "standard", "loose"];
const SINGLE_STRATEGIES = ["climax", "poster", "final"];
const VISUAL_SCOPE_FIELDS = [
    "characterAppearance",
    "styleLibrary",
    "styleActive",
    "sceneLibrary",
    "sceneActive",
    "confirmedCharacters",
];

export const BUILT_IN_STYLE_PRESETS = [
    {
        name: "Anime Character Key Art",
        text: "clean anime key art, consistent character proportions, expressive eyes, readable costume details, crisp linework, soft cel shading, balanced color accents, simple cinematic background, no clutter",
    },
    {
        name: "Cinematic Story Illustration",
        text: "cinematic narrative illustration, clear focal subject, dramatic but readable lighting, grounded environment details, natural pose language, shallow depth of field, film still composition, cohesive color contrast",
    },
    {
        name: "Light Novel Cover",
        text: "polished light novel cover illustration, iconic character silhouette, elegant outfit shapes, atmospheric setting cues, clean foreground-background separation, refined color harmony, high-detail commercial finish",
    },
];

export function createMemoryVisualScopeStore(initial = {}) {
    const data = new Map(Object.entries(initial).map(([key, value]) => [key, clonePlain(value)]));
    return {
        getItem(key) {
            return data.has(String(key)) ? JSON.stringify(data.get(String(key))) : null;
        },
        setItem(key, value) {
            const text = String(value ?? "");
            try {
                data.set(String(key), JSON.parse(text));
            } catch {
                data.set(String(key), text);
            }
        },
        removeItem(key) {
            data.delete(String(key));
        },
        dump() {
            return Object.fromEntries([...data.entries()].map(([key, value]) => [key, clonePlain(value)]));
        },
    };
}

export function createChatVisualScopeKey(context = {}) {
    const avatar = firstScopeValue(
        context.characterAvatar,
        context.avatar,
        context.avatarFile,
        context.character?.avatar,
    );
    const characterId = firstScopeValue(
        context.characterId,
        context.charId,
        context.character?.id,
        context.character?.index,
    );
    const characterName = firstScopeValue(
        context.characterName,
        context.charName,
        context.name2,
        context.character?.name,
    );
    const explicitCardKey = firstScopeValue(context.characterCardKey);

    const identity = avatar
        ? `avatar:${avatar}`
        : (characterId
            ? `id:${characterId}`
            : (characterName ? `name:${characterName}` : (explicitCardKey ? `key:${explicitCardKey}` : "unknown-character")));
    const slug = slugScopePart(identity) || "unknown-character";
    return `ST-OpenAI-Image-Relay:visual-scope:character-card:${slug}`;
}

export function loadChatVisualScope({ context = {}, settings = {}, store = null } = {}) {
    const scopeKey = createChatVisualScopeKey(context);
    const stored = readScopeRecord(store, scopeKey);
    const values = {};
    const sources = {};

    for (const field of VISUAL_SCOPE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(stored, field)) {
            if (hasScopeValue(stored[field])) {
                values[field] = clonePlain(stored[field]);
                sources[field] = "card";
            } else {
                values[field] = field === "confirmedCharacters" ? [] : "";
                sources[field] = "empty";
            }
        } else {
            values[field] = field === "confirmedCharacters" ? [] : "";
            sources[field] = "empty";
        }
    }

    return {
        scopeKey,
        values,
        sources,
        hasChatScope: Object.keys(stored).some((field) => VISUAL_SCOPE_FIELDS.includes(field)),
        hasCardScope: Object.keys(stored).some((field) => VISUAL_SCOPE_FIELDS.includes(field)),
        stored,
    };
}

export function sourceLabelForScopeSource(source) {
    const value = String(source || "").trim();
    if (value === "card" || value === "character-card") return "character-card library";
    if (value === "chat") return "character-card library";
    if (value === "legacy") return "imported legacy";
    if (value === "worldbook") return "worldbook";
    if (value === "story" || value === "story-derived") return "story-derived";
    if (value === "empty" || value === "missing") return "missing";
    return value || "missing";
}

export function saveChatVisualScopePatch({ context = {}, store = null, patch = {} } = {}) {
    const scopeKey = createChatVisualScopeKey(context);
    const stored = readScopeRecord(store, scopeKey);
    const next = { ...stored };
    for (const field of VISUAL_SCOPE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
            next[field] = clonePlain(patch[field]);
        }
    }
    next.updatedAt = new Date().toISOString();
    writeScopeRecord(store, scopeKey, next);
    return { scopeKey, values: next };
}

export function formatBuiltInStyleLibrary(presets = BUILT_IN_STYLE_PRESETS) {
    return normalizeBuiltInStylePresets(presets)
        .map((preset) => `${preset.name}: ${preset.text}`)
        .join("\n");
}

export function mergeBuiltInStylePresets(existingText = "", presets = BUILT_IN_STYLE_PRESETS) {
    return mergeVisualLibraryEntries(existingText, normalizeBuiltInStylePresets(presets), { kind: "style" });
}

export function normalizeVisualExtractionSettings(settings = {}) {
    return {
        autoExtractCharactersEnabled: !!settings.autoExtractCharactersEnabled,
        autoExtractScenesEnabled: !!settings.autoExtractScenesEnabled,
    };
}

export function applyAutomaticVisualExtraction({ context = {}, settings = {}, store = null, sourceText = "" } = {}) {
    const normalized = normalizeVisualExtractionSettings(settings);
    const scope = loadChatVisualScope({ context, settings: {}, store });
    const patch = {};
    const character = normalized.autoExtractCharactersEnabled
        ? mergeVisualLibraryEntries(
            scope.values.characterAppearance,
            extractVisualLibraryEntriesFromText(sourceText, { kind: "character" }),
            { kind: "character" },
        )
        : createEmptyMergeResult(scope.values.characterAppearance);
    const scene = normalized.autoExtractScenesEnabled
        ? mergeVisualLibraryEntries(
            scope.values.sceneLibrary,
            extractVisualLibraryEntriesFromText(sourceText, { kind: "scene" }),
            { kind: "scene" },
        )
        : createEmptyMergeResult(scope.values.sceneLibrary);

    if (normalized.autoExtractCharactersEnabled && character.changed) patch.characterAppearance = character.text;
    if (normalized.autoExtractScenesEnabled && scene.changed) patch.sceneLibrary = scene.text;

    const saved = Object.keys(patch).length
        ? saveChatVisualScopePatch({ context, store, patch })
        : { scopeKey: scope.scopeKey, values: scope.values };

    return {
        scopeKey: saved.scopeKey,
        character,
        scene,
    };
}

export function extractVisualLibraryEntriesFromText(sourceText = "", { kind = "character" } = {}) {
    const normalizedKind = kind === "scene" ? "scene" : "character";
    const entries = [];
    for (const line of splitVisualParagraphs(sourceText)) {
        const entry = parseVisualExtractionLine(line, normalizedKind);
        if (entry) entries.push(entry);
    }
    return dedupeEntriesByName(entries);
}

export function mergeVisualLibraryEntries(existingText = "", entries = [], { kind = "generic" } = {}) {
    const lines = splitLibraryLines(existingText);
    const existingNames = new Map();
    for (const line of lines) {
        const parsed = parseLibraryEntryLine(line);
        if (parsed) existingNames.set(normalizeLibraryEntryName(parsed.name), parsed.name);
    }

    const added = [];
    const skipped = [];
    const nextLines = [...lines];
    for (const entry of entries || []) {
        const clean = normalizeLibraryEntry(entry, kind);
        if (!clean) continue;
        const key = normalizeLibraryEntryName(clean.name);
        if (existingNames.has(key)) {
            skipped.push(clean);
            continue;
        }
        existingNames.set(key, clean.name);
        added.push(clean);
        nextLines.push(`${clean.name}: ${clean.text}`);
    }

    return {
        text: nextLines.join("\n"),
        added,
        skipped,
        changed: added.length > 0,
    };
}

export function resolveChatVisualBible({ context = {}, settings = {}, store = null, sourceText = "" } = {}) {
    const scope = loadChatVisualScope({ context, settings, store });
    const style = resolveNamedLibraryValue(scope.values.styleLibrary, scope.values.styleActive);
    const scene = resolveNamedLibraryValue(scope.values.sceneLibrary, scope.values.sceneActive);
    const charactersText = String(scope.values.characterAppearance || "").trim();
    const styleText = style.text || String(scope.values.styleLibrary || "").trim();
    const scenesText = scene.text || String(scope.values.sceneLibrary || "").trim();
    const fixed = {
        styleText,
        charactersText,
        scenesText,
    };
    const mentionedCharacters = collectVisibleCharacters(sourceText, charactersText);
    const storedConfirmedCharacters = normalizeConfirmedCharacterNames(scope.values.confirmedCharacters);
    const confirmedCharacters = storedConfirmedCharacters.length
        ? storedConfirmedCharacters
        : mentionedCharacters;
    const sourceLabels = Object.fromEntries(
        Object.entries(scope.sources).map(([field, source]) => [field, sourceLabelForScopeSource(source)]),
    );
    const personaCandidates = resolvePersonaVisualCandidates({
        context,
        sourceText,
        visualBible: {
            fixed,
            values: scope.values,
            confirmedCharacters,
        },
    });
    return {
        scopeKey: scope.scopeKey,
        storageSource: scope.hasCardScope ? "character-card" : "empty",
        values: scope.values,
        sources: scope.sources,
        sourceLabels,
        fixed,
        styleText,
        charactersText,
        scenesText,
        activeStyle: style.name || String(scope.values.styleActive || ""),
        activeScene: scene.name || String(scope.values.sceneActive || ""),
        confirmedCharacters,
        characterCandidates: personaCandidates,
        diagnostics: {
            scopeKey: scope.scopeKey,
            storageSource: scope.hasCardScope ? "character-card" : "empty",
            sources: { ...scope.sources },
            sourceLabels,
            activeStyle: style.name || String(scope.values.styleActive || ""),
            activeScene: scene.name || String(scope.values.sceneActive || ""),
            mentionedCharacters,
            confirmedCharacters,
            characterCandidates: personaCandidates,
            legacyFallbackUsed: false,
        },
    };
}

export function classifyImageGenerationError(error) {
    const rawMessage = collectErrorText(error);
    const lower = rawMessage.toLowerCase();
    let errorClass = "backend";
    if (
        /content_policy_violation|policy_violation|safety_policy|content policy|policy refusal/i.test(rawMessage)
        || /内容政策|内容安全|违反.*政策|安全策略|政策拒绝/.test(rawMessage)
    ) {
        errorClass = "policy";
    } else if (
        error?.name === "AbortError"
        || /abort|timeout|timed out|failed to fetch|network|econnreset|econnrefused|etimedout|fetch failed/i.test(rawMessage)
    ) {
        errorClass = "network";
    } else if (
        error instanceof SyntaxError
        || /json|parse|unexpected token|unexpected end|invalid response|无法解析|解析失败/i.test(rawMessage)
    ) {
        errorClass = "parse";
    }

    return {
        errorClass,
        summary: summarizeImageGenerationError(errorClass, rawMessage),
        rawMessage,
    };
}

export function createPolicySafeRetryPrompt(prompt, options = {}) {
    const original = String(prompt || "").replace(/\s+/g, " ").trim();
    const visualBibleSummary = String(options.visualBibleSummary || "").replace(/\s+/g, " ").trim();
    const rewritten = softenSensitiveImagePrompt(original);
    return [
        visualBibleSummary ? `设定参考：${visualBibleSummary}` : "",
        rewritten,
        "SFW安全版本：减少、弱化并移除血腥、伤口、露骨伤害、色情、裸露、剥削性或恐怖细节；保留允许的人物身份、构图、动作方向、服装、场景和画风一致性。",
        "画面表达改为非血腥的紧张对峙、保护、闪避、克制动作和戏剧光影，不生成可见鲜血、重伤、肢体损伤或恐怖特写。",
    ].filter(Boolean).join("\n");
}

export function canUsePolicySafeRetry(job = {}) {
    return String(job?.errorClass || "").trim() === "policy" && Number(job?.policyRetryCount || 0) < 1;
}

export function resolvePersonaVisualCandidates({ context = {}, sourceText = "", visualBible = null } = {}) {
    const source = String(sourceText || "");
    const fixed = normalizeFixedReferences(visualBible?.fixed || visualBible);
    const fixedNames = new Set((fixed.characters || []).map((entry) => entry.name));
    const names = collectPersonaNames(context, source);
    const candidates = [];

    for (const name of names) {
        if (!name || fixedNames.has(name)) continue;
        const contextText = collectPersonaContextText(context, name);
        const storyText = collectNameContextSnippet(source, name);
        const text = contextText || storyText || `${name}：主角/用户人物，外貌待确认；保留其姓名、身份、当前动作和表情。`;
        candidates.push({
            name,
            text: text.includes(name) ? text : `${name}：${text}`,
            source: contextText ? "story-derived" : (storyText ? "story-derived" : "missing"),
            selected: true,
        });
    }

    return dedupeCandidates(candidates);
}

export function confirmCharacterCandidatesIntoScope({ context = {}, store = null, candidates = [] } = {}) {
    const selected = (Array.isArray(candidates) ? candidates : [])
        .filter((candidate) => candidate && candidate.selected !== false)
        .map((candidate) => ({
            name: String(candidate.name || "").trim(),
            text: String(candidate.text || candidate.description || "").trim(),
        }))
        .filter((candidate) => candidate.name && candidate.text);

    const scope = loadChatVisualScope({ context, settings: {}, store });
    const characterAppearance = mergeNamedReferenceText(scope.values.characterAppearance, selected);
    const confirmedCharacters = dedupeStrings([
        ...normalizeConfirmedCharacterNames(scope.values.confirmedCharacters),
        ...selected.map((candidate) => candidate.name),
    ]);

    return saveChatVisualScopePatch({
        context,
        store,
        patch: {
            characterAppearance,
            confirmedCharacters,
        },
    });
}

export function normalizePromptSafetyLevel(value) {
    const key = String(value || "").trim();
    return PROMPT_SAFETY_LEVELS.includes(key) ? key : "standard";
}

export function normalizeSinglePromptStrategy(value) {
    const key = String(value || "").trim();
    return SINGLE_STRATEGIES.includes(key) ? key : "climax";
}

function cleanSourceForVisualPlanning(text) {
    return String(text || "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
        .replace(/<options\b[^>]*>[\s\S]*?<\/options>/gi, "\n")
        .replace(/<disclaimer\b[^>]*>[\s\S]*?<\/disclaimer>/gi, "\n")
        .replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi, "\n")
        .replace(/<StatusPlaceHolderImpl\b[^>]*\/?>/gi, "\n")
        .replace(/(?:^|\n)\s*[.#][\w-]+\s*\{[\s\S]*?\}\s*/g, "\n")
        .replace(/[.#][\w-]+\s*\{[^{}]*\}/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function splitVisualParagraphs(text) {
    return cleanSourceForVisualPlanning(text)
        .split(/\n{2,}|\r?\n/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((line) => !isLowVisualSystemLine(line));
}

export function planSingleImageTarget(sourceText, options = {}) {
    const strategy = normalizeSinglePromptStrategy(options.strategy);
    const planningText = cleanSourceForVisualPlanning(sourceText);
    const paragraphs = splitVisualParagraphs(planningText);
    const fallback = String(planningText || "").replace(/\s+/g, " ").trim();
    const candidates = paragraphs.length ? paragraphs : (fallback ? [fallback] : []);
    const scored = candidates.map((text, index) => ({
        text,
        index,
        score: scoreVisualParagraph(text, index, candidates.length),
    }));

    let selected;
    if (strategy === "final") {
        selected = [...scored].reverse().find((item) => item.score > -20) || scored[scored.length - 1];
    } else if (strategy === "poster") {
        selected = {
            text: buildPosterMoment(candidates),
            index: -1,
            score: 0,
        };
    } else {
        selected = scored.sort((a, b) => b.score - a.score || b.index - a.index)[0];
    }

    const visualMoment = selected?.text || fallback || "当前剧情中最具代表性的安全画面。";
    const contextText = selected?.index >= 0
        ? [candidates[selected.index - 1], visualMoment, candidates[selected.index + 1]].filter(Boolean).join("\n")
        : visualMoment;
    const characters = options.characters?.length
        ? dedupeStrings(options.characters)
        : collectVisibleCharacters(contextText, options.fixed?.charactersText || options.fixed?.characters || "");
    const anchors = collectVisualAnchors(visualMoment);
    return {
        strategy,
        title: strategy === "poster" ? "总结海报" : (strategy === "final" ? "最后镜头" : "剧情高潮"),
        visualMoment,
        scene: inferSceneText(sourceText, options.fixed),
        characters,
        actions: collectActionPhrases(visualMoment),
        anchors,
    };
}

export function createSingleImagePlanFromSource(sourceText, options = {}) {
    const visualBible = options.visualBible || null;
    const fixed = options.fixed || visualBible?.fixed || visualBible || null;
    const target = planSingleImageTarget(sourceText, { ...options, fixed });
    const job = {
        mode: "single",
        title: target.title,
        characters: target.characters,
        scene: target.scene,
        promptParts: target,
    };
    const compiled = compileImagePrompt({
        mode: "single",
        fixed,
        visualBible,
        strategy: target.strategy,
        job,
    });
    return {
        mode: "single",
        sourceText: String(sourceText || ""),
        fixed,
        visualBible,
        strategy: target.strategy,
        selectedTarget: target,
        jobs: [{
            ...job,
            prompt: compiled.prompt,
            promptDiagnostics: compiled.diagnostics,
        }],
    };
}

export function compileImagePrompt(input = {}) {
    const mode = String(input.mode || input.job?.mode || "single");
    const visualBible = input.visualBible || null;
    const fixed = normalizeFixedReferences(input.fixed || visualBible?.fixed || visualBible);
    const job = input.job || {};
    const parts = normalizePromptParts(job.promptParts || job, mode, input);
    const visibleCharacters = dedupeStrings([
        ...(Array.isArray(parts.characters) ? parts.characters : []),
        ...(Array.isArray(job.characters) ? job.characters : []),
        ...(Array.isArray(visualBible?.confirmedCharacters) ? visualBible.confirmedCharacters : []),
    ]);
    const scopedCharacters = scopeCharacterReferences(fixed.characters, visibleCharacters, input.strategy);
    const candidateCharacters = scopeCandidateReferences(visualBible?.characterCandidates, visibleCharacters);
    const missingCharacters = visibleCharacters.filter((name) => (
        !scopedCharacters.some((entry) => entry.name === name)
        && !candidateCharacters.some((entry) => entry.name === name)
    ));
    const dialogue = dedupeStrings(parts.dialogue || []);
    const imageTextPolicy = resolveImageTextPolicy(mode, parts);

    const sections = [];
    sections.push(`风格与质感：${fixed.style || defaultStyleForMode(mode)}`);
    sections.push(`主体：${buildSubjectLine(mode, parts, visibleCharacters)}`);
    const characterLines = [
        ...scopedCharacters.map((entry) => `${entry.name}：${entry.description}`),
        ...candidateCharacters.map((entry) => `${entry.name}：${entry.description || entry.text}（待确认候选，保持姓名和当前剧情身份一致）`),
        ...missingCharacters.map((name) => `${name}：无固定外貌参考（no fixed appearance reference），保留其姓名、身份、当前动作和表情，不要替换为无名角色。`),
    ];
    if (characterLines.length) {
        sections.push(`人物设定：${characterLines.join("；")}`);
    }
    sections.push(`镜头构图：${buildCompositionLine(mode, parts)}`);
    sections.push(`动作表情：${buildActionLine(parts)}`);
    sections.push(`场景光影：${buildSceneLine(parts, fixed)}`);
    sections.push(`视觉锚点：${buildAnchorsLine(parts)}`);
    sections.push(`连续性：${parts.continuity || "保持同一角色外貌、服装、道具和场景方向一致，不要凭空更换人物特征。"}`);
    sections.push(`文字/对白：${buildDialogueLine(mode, parts)}`);
    sections.push(`避免：${buildNegativeLine(mode)}`);

    return {
        prompt: sections.filter(Boolean).join("\n").trim(),
        diagnostics: {
            ...(visualBible?.diagnostics || {}),
            mode,
            strategy: input.strategy || parts.strategy || "",
            visibleCharacters,
            scopedCharacters: scopedCharacters.map((entry) => entry.name),
            candidateCharacters: candidateCharacters.map((entry) => entry.name),
            missingCharacters,
            dialogueMode: parts.dialogueMode || "",
            dialogueEnabled: mode === "comic" ? !!parts.dialogueEnabled : false,
            dialogue,
            caption: parts.caption || "",
            imageTextPolicy,
        },
    };
}

function normalizePromptParts(parts, mode, input = {}) {
    const source = parts || {};
    const explicitDialogueEnabled = input.dialogueEnabled ?? source.dialogueEnabled;
    const dialogue = Array.isArray(source.dialogue) ? source.dialogue : [];
    const caption = source.caption || "";
    return {
        strategy: source.strategy || "",
        title: source.title || "",
        visualMoment: source.visualMoment || source.imageDescription || source.prompt || source.description || source.title || "",
        shot: source.shot || source.shotType || "",
        scene: source.scene || "",
        characters: Array.isArray(source.characters) ? source.characters : [],
        actions: Array.isArray(source.actions) ? source.actions : [],
        anchors: Array.isArray(source.anchors) ? source.anchors : [],
        dialogue,
        caption,
        dialogueMode: source.dialogueMode || (mode === "comic" ? "bubble" : ""),
        dialogueEnabled: mode === "comic"
            ? (explicitDialogueEnabled == null ? (dialogue.length > 0 || !!String(caption).trim()) : !!explicitDialogueEnabled)
            : false,
        continuity: source.continuity || "",
    };
}

function normalizeFixedReferences(fixed = {}) {
    return {
        style: String(fixed?.styleText || fixed?.style || "").trim(),
        characters: parseNamedReferences(fixed?.charactersText || fixed?.characters || ""),
        scenes: String(fixed?.scenesText || fixed?.scenes || "").trim(),
    };
}

function parseNamedReferences(text) {
    return String(text || "")
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
            if (!match) return null;
            return {
                name: match[1].trim(),
                description: cleanupReferenceDescription(match[2]),
            };
        })
        .filter((entry) => entry?.name && entry?.description);
}

function scopeCharacterReferences(references, visibleCharacters, strategy = "") {
    if (!references.length) return [];
    const visible = new Set(visibleCharacters.map((name) => String(name || "").trim()).filter(Boolean));
    if (String(strategy || "") === "poster" && visible.size === 0) return references.slice(0, 5);
    return references.filter((entry) => visible.has(entry.name));
}

function scopeCandidateReferences(candidates, visibleCharacters) {
    if (!Array.isArray(candidates) || !candidates.length) return [];
    const visible = new Set(visibleCharacters.map((name) => String(name || "").trim()).filter(Boolean));
    return candidates
        .map((candidate) => ({
            name: String(candidate?.name || "").trim(),
            description: cleanupReferenceDescription(candidate?.description || candidate?.text || ""),
            source: sourceLabelForScopeSource(candidate?.source || "story-derived"),
        }))
        .filter((entry) => entry.name && entry.description && visible.has(entry.name));
}

function cleanupReferenceDescription(text) {
    return String(text || "")
        .split(/[;；]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part, index, arr) => arr.indexOf(part) === index)
        .join("；");
}

function collectVisibleCharacters(text, characterText) {
    return dedupeStrings([
        ...collectLikelyNamedCharacters(text),
        ...collectMentionedCharacters(text, characterText),
    ]);
}

function collectMentionedCharacters(text, characterText) {
    const refs = parseNamedReferences(characterText);
    const source = String(text || "");
    return refs.filter((entry) => source.includes(entry.name)).map((entry) => entry.name);
}

function collectLikelyNamedCharacters(text) {
    const source = String(text || "");
    const namePattern = String.raw`([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9_·]{1,11}?)`;
    const patterns = [
        new RegExp(String.raw`(?:^|[。！？；;\n])\s*${namePattern}(?=(?:在|把|向|对|从|与|和|朝|将|用|举|握|拔|回头|挡|站|看|低语|喊|冲|躲|横移|转身|收|露出|注视|侧身|反手))`, "gu"),
        new RegExp(String.raw`(?:挡在|护住|看着|望向|转向|冲着|对着|靠近|拉住|抓住|扶住|保护|挡住)${namePattern}(?=(?:前方|身前|身后|旁边|[，,。！？；;\s]|$))`, "gu"),
        new RegExp(String.raw`(?:与|和|跟)${namePattern}(?=(?:一起|并肩|对峙|交错|[，,。！？；;\s]|$))`, "gu"),
    ];
    const names = [];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const name = String(match[1] || "").trim();
            if (!isLikelyNonCharacterName(name)) names.push(name);
        }
    }
    return dedupeStrings(names).slice(0, 8);
}

function isLikelyNonCharacterName(name) {
    const value = String(name || "").trim();
    if (value.length < 2 || value.length > 12) return true;
    if (/^(自然光|柔和自然光|阳光|月光|灯光|光线|光影|窗边|图书馆|地图|晴朗下午)$/.test(value)) return true;
    const generic = /^(这个|那个|这些|那些|一个|一名|几名|几个|众人|人群|路人|敌人|对手|混混|壮汉|少女|男子|女人|男人)$/;
    if (generic.test(value)) return true;
    if (/^[\p{Script=Han}]{2,10}(?:上|下|中|里|内|外|旁|边|前|后|间|处)$/u.test(value)) return true;
    return /街道|石板|长剑|重剑|剑尖|药剂|药水|露液|腰间|腰包|地面|前方|后方|画面|场景|光影|道具|瓶|手中|脚下/.test(value);
}

function collectActionPhrases(text) {
    const actions = [];
    const source = String(text || "");
    const patterns = [
        /[^。！？；;，,]*(?:闪避|横移|反击|挡|拔|饮下|回头|喊|刺|挥|握|冲|甩|拽|躲开|逼退)[^。！？；;，,]*/g,
        /[^。！？；;，,]*(?:露出|注视|眨眼|冷眼|惊恐|警惕|紧张)[^。！？；;，,]*/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const value = String(match[0] || "").trim();
            if (value && value.length <= 80) actions.push(value);
        }
    }
    return dedupeStrings(actions).slice(0, 4);
}

function collectVisualAnchors(text) {
    const anchors = [];
    const source = String(text || "");
    for (const match of source.matchAll(/[「『【\[]([^」』】\]]{2,24})[」』】\]]/g)) {
        anchors.push(match[1]);
    }
    const keywords = ["圣杯瓶", "金色露液", "长剑", "剑尖", "街道", "石板路", "人群", "腰包", "重剑"];
    for (const keyword of keywords) {
        if (source.includes(keyword)) anchors.push(keyword);
    }
    return dedupeStrings(anchors).slice(0, 6);
}

function inferSceneText(sourceText, fixed = {}) {
    const fixedScene = String(fixed?.scenesText || fixed?.scenes || "").trim();
    if (fixedScene) return fixedScene;
    const source = String(sourceText || "");
    if (/街道|巷|广场|石板路/.test(source)) return "城镇街道或广场附近，人物处于紧张对峙或行动现场。";
    if (/室内|房间|大厅|酒馆/.test(source)) return "室内空间，注意家具、入口、窗光和人物站位。";
    return "当前剧情发生地点，保留原文中的环境线索和空间关系。";
}

function buildPosterMoment(candidates) {
    const joined = candidates.join(" ");
    return joined.length > 320 ? `${joined.slice(0, 320)}...` : joined;
}

function scoreVisualParagraph(text, index, total) {
    const source = String(text || "");
    let score = 0;
    const strongWords = ["突然", "瞬间", "冲", "闪", "剑", "挡", "刺", "反击", "躲开", "喊", "危机", "高潮", "回头", "注视"];
    const weakWords = ["状态:", "骰运:", "结果:", "目标剩余:", "HP", "判定", "规则", "token", "TavernDB"];
    for (const word of strongWords) if (source.includes(word)) score += 6;
    for (const word of weakWords) if (source.includes(word)) score -= 18;
    if (/「.+」/.test(source)) score += 4;
    if (source.length >= 20 && source.length <= 180) score += 5;
    if (source.length > 260) score -= 4;
    score += Math.min(index, total) * 0.4;
    return score;
}

function isLowVisualSystemLine(text) {
    return /^(角色|动作|目标|骰运|结果|目标剩余|状态|特图的旁白)\s*:/.test(String(text || "").trim());
}

function defaultStyleForMode(mode) {
    if (mode === "comic") return "漫画分格，清晰线条，角色表情明确，动态构图。";
    return "高质量插画，清晰主体，电影感构图，细节丰富。";
}

function buildSubjectLine(mode, parts, characters) {
    const names = characters.length ? `出场人物 ${characters.join("、")}；` : "";
    const label = mode === "comic" ? "本格画面" : "本图画面";
    return `${names}${label}聚焦于${parts.visualMoment || parts.title || "当前剧情的关键视觉瞬间"}`;
}

function buildCompositionLine(mode, parts) {
    const shot = parts.shot ? `${parts.shot}，` : "";
    if (mode === "comic") {
        return `${shot}分格内主体清晰，人物站位左右/前后关系明确，留出对白气泡叠加空间但图片本身不承载文字。`;
    }
    return `${shot}明确前景主体、中景互动和背景环境，避免多画面拼贴，保持单张完整构图。`;
}

function buildActionLine(parts) {
    const actions = dedupeStrings(parts.actions || []);
    if (actions.length) return actions.join("；");
    return "人物动作、表情和视线方向要能表达当前剧情情绪。";
}

function buildSceneLine(parts, fixed) {
    const scene = [parts.scene, fixed.scenes].map((value) => String(value || "").trim()).filter(Boolean);
    return scene.length ? scene.join("；") : "保留当前剧情的地点、时间、光影、天气、人群和建筑线索。";
}

function buildAnchorsLine(parts) {
    const anchors = dedupeStrings(parts.anchors || []);
    return anchors.length ? anchors.join("；") : "保留关键道具、服装、武器、光效、背景标志和空间线索。";
}

function buildDialogueLine(mode, parts) {
    if (mode !== "comic") return "除非原提示明确要求招牌或界面文字，否则不要生成任何文字、字幕或水印。";
    const lines = dedupeStrings(parts.dialogue || []);
    const caption = String(parts.caption || "").trim();
    if (!parts.dialogueEnabled) {
        return "对白生成已关闭；不要生成任何对白、字幕、水印或额外文字。 Dialogue generation disabled; no readable text.";
    }
    if (parts.dialogueMode === "modelText") {
        const text = [...lines, caption && `旁白：${caption}`].filter(Boolean).join("；");
        return text
            ? `可在画面中绘制清晰可读的中文对白气泡：${text} Render readable dialogue text in the image.`
            : "可按漫画风格保留气泡区域，但不要生成无意义文字。 Render readable dialogue only when explicit dialogue is provided.";
    }
    const stored = [...lines, caption && `旁白：${caption}`].filter(Boolean).join("；");
    return stored
        ? `不要在图片中出现任何文字、对白气泡或字幕；对白由插件气泡显示：${stored} Do not render readable text; plugin bubble overlay will display dialogue.`
        : "不要在图片中出现任何文字、对白气泡或字幕；对白由插件气泡显示。 Do not render readable text; plugin bubble overlay will display dialogue.";
}

function buildNegativeLine(mode) {
    const base = "避免低清晰度、畸形手指、多余肢体、角色脸崩、人物身份混淆、无关角色入镜、现代水印、乱码文字、画面拼贴。";
    if (mode === "comic") return `${base} 插件气泡模式下尤其避免模型自行生成文字。`;
    return base;
}

function resolveImageTextPolicy(mode, parts) {
    if (mode !== "comic") return "no-text";
    if (!parts.dialogueEnabled) return "dialogue-disabled";
    return parts.dialogueMode === "modelText" ? "model-text" : "plugin-bubble";
}

function collectErrorText(value, seen = new Set()) {
    if (value == null) return "";
    if (seen.has(value)) return "";
    if (typeof value === "object") seen.add(value);
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";
        try {
            const parsed = JSON.parse(trimmed);
            const nested = collectErrorText(parsed, seen);
            return nested ? `${trimmed}\n${nested}` : trimmed;
        } catch {
            return trimmed;
        }
    }
    if (typeof value !== "object") return String(value);

    const pieces = [];
    if (value.name) pieces.push(String(value.name));
    if (value.code) pieces.push(String(value.code));
    if (value.type) pieces.push(String(value.type));
    if (value.message) pieces.push(String(value.message));
    if (value.status) pieces.push(String(value.status));
    if (value.statusText) pieces.push(String(value.statusText));
    if (value.error) pieces.push(collectErrorText(value.error, seen));
    if (value.response) pieces.push(collectErrorText(value.response, seen));
    if (value.body) pieces.push(collectErrorText(value.body, seen));
    if (value.stack) pieces.push(String(value.stack));
    try {
        pieces.push(JSON.stringify(value));
    } catch {
        // Ignore non-serializable objects; collected fields above are enough.
    }
    return dedupeStrings(pieces).join("\n");
}

function summarizeImageGenerationError(errorClass, rawMessage) {
    if (errorClass === "policy") {
        return "图片后端拒绝：可能触发内容政策，请使用安全重试或修改提示词。";
    }
    if (errorClass === "network") {
        return "后端网络请求失败，请检查地址、端口、代理或超时设置。";
    }
    if (errorClass === "parse") {
        return "后端响应解析失败，请检查返回格式或图片提取规则。";
    }
    const compact = String(rawMessage || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
    return compact ? `后端请求失败：${compact}` : "后端请求失败。";
}

function softenSensitiveImagePrompt(prompt) {
    let text = String(prompt || "").trim();
    const replacements = [
        [/血腥厮杀|血腥战斗|残酷厮杀|厮杀/g, "紧张对峙"],
        [/鲜血|流血|喷血|血迹|血泊/g, "戏剧化光影"],
        [/伤口|创口|重伤|断肢|肢解|内脏/g, "安全动作细节"],
        [/恐怖表情|惊恐扭曲|痛苦特写/g, "紧张但克制的表情"],
        [/杀死|击杀|处决|虐杀/g, "制止"],
        [/色情|裸露|性暗示|性行为/g, "安全服装与自然姿态"],
    ];
    for (const [pattern, replacement] of replacements) {
        text = text.replace(pattern, replacement);
    }
    return text || "安全、非血腥的角色互动场景，保持人物和构图一致。";
}

function collectPersonaNames(context = {}, sourceText = "") {
    const meta = context.chatMetadata || context.metadata || {};
    const candidates = [
        context.userName,
        context.name1,
        context.user_name,
        context.personaName,
        context.persona_name,
        context.protagonistName,
        context.playerName,
        context.player_name,
        meta.userName,
        meta.name1,
        meta.personaName,
        meta.protagonistName,
        meta.playerName,
    ];
    const source = String(sourceText || "");
    for (const match of source.matchAll(/(?:我是|我叫|本人名叫|主角名叫)\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9_]{1,11})/gu)) {
        candidates.push(match[1]);
    }
    for (const match of source.matchAll(/(?:主角|用户|玩家)[：:]\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9_]{1,11})/gu)) {
        candidates.push(match[1]);
    }
    return dedupeStrings(candidates)
        .filter((name) => !isLikelyNonCharacterName(name))
        .filter((name) => !source || source.includes(name) || hasPersonaContextForName(context, name));
}

function hasPersonaContextForName(context, name) {
    return collectPersonaContextText(context, name).length > 0;
}

function collectPersonaContextText(context = {}, name = "") {
    const meta = context.chatMetadata || context.metadata || {};
    const fields = [
        context.personaAppearance,
        context.userAppearance,
        context.personaDescription,
        context.userDescription,
        context.persona,
        context.userPersona,
        meta.personaAppearance,
        meta.userAppearance,
        meta.personaDescription,
        meta.userDescription,
        meta.persona,
        meta.userPersona,
    ];
    const text = dedupeStrings(fields)
        .map((value) => String(value || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("；");
    if (!text) return "";
    return text.includes(name) ? text : `${name}：${text}`;
}

function collectNameContextSnippet(sourceText, name) {
    const source = String(sourceText || "").replace(/\s+/g, " ").trim();
    if (!source || !name || !source.includes(name)) return "";
    const escaped = escapeRegExp(name);
    const sentencePattern = new RegExp(`[^。！？!?；;\\n]{0,40}${escaped}[^。！？!?；;\\n]{0,80}`, "u");
    const match = source.match(sentencePattern);
    const snippet = String(match?.[0] || source).trim().slice(0, 140);
    return `${name}：主角/用户人物，故事片段：${snippet}`;
}

function dedupeCandidates(candidates) {
    const byName = new Map();
    for (const candidate of candidates || []) {
        const name = String(candidate?.name || "").trim();
        if (!name || byName.has(name)) continue;
        byName.set(name, candidate);
    }
    return [...byName.values()];
}

function normalizeBuiltInStylePresets(presets = BUILT_IN_STYLE_PRESETS) {
    return (Array.isArray(presets) ? presets : [])
        .map((preset) => ({
            name: String(preset?.name || "").trim(),
            text: cleanVisualEntryText(preset?.text || preset?.description || ""),
        }))
        .filter((preset) => preset.name && preset.text);
}

function createEmptyMergeResult(text = "") {
    return {
        text: splitLibraryLines(text).join("\n"),
        added: [],
        skipped: [],
        changed: false,
    };
}

function splitLibraryLines(text = "") {
    return String(text || "")
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function parseLibraryEntryLine(line = "") {
    const match = String(line || "").trim().match(/^([^:\uFF1A]{1,60})[:\uFF1A]\s*(.+)$/u);
    if (!match) return null;
    const name = String(match[1] || "").trim();
    const text = cleanVisualEntryText(match[2]);
    return name && text ? { name, text } : null;
}

function normalizeLibraryEntryName(name = "") {
    return String(name || "")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function normalizeLibraryEntry(entry, kind = "generic") {
    const name = String(entry?.name || "").trim();
    const text = cleanVisualEntryText(entry?.text || entry?.description || "");
    if (!name || !text) return null;
    if (isLowValueVisualEntry(name) || isLowValueVisualEntry(text)) return null;
    if (kind !== "style" && text.length < 12) return null;
    return { name, text, source: entry?.source || "auto-extracted" };
}

function parseVisualExtractionLine(line = "", kind = "character") {
    const source = String(line || "").replace(/\s+/g, " ").trim();
    if (!source || isLowValueVisualEntry(source)) return null;
    const prefix = kind === "scene"
        ? String.raw`(?:scene|setting|location|place|environment|\u573A\u666F|\u5730\u70B9|\u73AF\u5883|\u80CC\u666F)`
        : String.raw`(?:character|role|person|figure|\u4EBA\u7269|\u89D2\u8272|\u5916\u8C8C)`;
    const prefixed = source.match(new RegExp(String.raw`^${prefix}\s+([^:\uFF1A]{1,40})[:\uFF1A]\s*(.+)$`, "iu"));
    if (prefixed) {
        return normalizeLibraryEntry({
            name: prefixed[1],
            text: prefixed[2],
        }, kind);
    }
    return null;
}

function dedupeEntriesByName(entries = []) {
    const byName = new Map();
    for (const entry of entries || []) {
        const clean = normalizeLibraryEntry(entry);
        if (!clean) continue;
        const key = normalizeLibraryEntryName(clean.name);
        if (!byName.has(key)) byName.set(key, clean);
    }
    return [...byName.values()];
}

function cleanVisualEntryText(text = "") {
    return String(text || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[;；]\s*/g, ", ")
        .replace(/,+/g, ",")
        .replace(/\s+,/g, ",")
        .replace(/,\s*$/g, "")
        .trim();
}

function isLowValueVisualEntry(text = "") {
    const value = String(text || "").trim();
    if (!value) return true;
    return /<[^>]*>|workflow|system prompt|instruction|status|token|javascript|html|css|json|plugin setting|configuration|do not|ignore previous/i.test(value);
}

function mergeNamedReferenceText(existingText, selectedCandidates) {
    const lines = String(existingText || "")
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const nextLines = [...lines];
    const indexByName = new Map();
    for (const [index, line] of nextLines.entries()) {
        const parsed = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
        if (parsed) indexByName.set(parsed[1].trim(), index);
    }
    for (const candidate of selectedCandidates || []) {
        const line = `${candidate.name}: ${stripCandidateNamePrefix(candidate.name, candidate.text)}`;
        if (indexByName.has(candidate.name)) {
            nextLines[indexByName.get(candidate.name)] = line;
        } else {
            indexByName.set(candidate.name, nextLines.length);
            nextLines.push(line);
        }
    }
    return nextLines.join("\n");
}

function stripCandidateNamePrefix(name, text) {
    const value = String(text || "").trim();
    const pattern = new RegExp(`^${escapeRegExp(name)}\\s*[:：]\\s*`, "u");
    return cleanupReferenceDescription(value.replace(pattern, ""));
}

function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugScopePart(value) {
    return String(value ?? "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[|\\/:*?"<>]/g, "_")
        .slice(0, 120);
}

function firstScopeValue(...values) {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
    }
    return "";
}

function hasScopeValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return String(value ?? "").trim().length > 0;
}

function clonePlain(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        } catch {
            // Fall through to JSON clone.
        }
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function readScopeRecord(store, scopeKey) {
    if (!store || !scopeKey) return {};
    try {
        let raw;
        if (typeof store.getItem === "function") raw = store.getItem(scopeKey);
        else if (typeof store.get === "function") raw = store.get(scopeKey);
        else raw = store[scopeKey];
        if (!raw) return {};
        if (typeof raw === "string") {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : {};
        }
        return raw && typeof raw === "object" ? clonePlain(raw) : {};
    } catch {
        return {};
    }
}

function writeScopeRecord(store, scopeKey, record) {
    if (!store || !scopeKey) return;
    const value = JSON.stringify(record || {});
    if (typeof store.setItem === "function") {
        store.setItem(scopeKey, value);
    } else if (typeof store.set === "function") {
        store.set(scopeKey, clonePlain(record || {}));
    } else {
        store[scopeKey] = clonePlain(record || {});
    }
}

function resolveNamedLibraryValue(libraryText, activeName) {
    const entries = parseNamedReferences(libraryText);
    const wanted = String(activeName || "").trim();
    if (wanted) {
        const found = entries.find((entry) => entry.name === wanted);
        if (found) return { name: found.name, text: `${found.name}: ${found.description}` };
    }
    if (entries.length === 1) {
        const only = entries[0];
        return { name: only.name, text: `${only.name}: ${only.description}` };
    }
    return { name: wanted, text: "" };
}

function normalizeConfirmedCharacterNames(value) {
    if (!Array.isArray(value)) return [];
    return dedupeStrings(value.map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return item.name || item.text || "";
        return "";
    }));
}

function dedupeStrings(values) {
    return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}
