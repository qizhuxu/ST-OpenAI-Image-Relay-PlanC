const NON_VISUAL_HINTS = /脑海|意识|内心|旁白|系统|声音|回荡|扫描|命令|只在意识|没有实体|并没有实体|不可见|虚拟|narrator|inner voice|system spirit/i;
const IN_IMAGE_TEXT_RISK = /绘制.*(?:文字|对白|字幕)|画面中.*(?:文字|对白|字幕)|清晰中文对白|可读(?:文字|对白)|对白气泡|字幕|水印|draw readable|render readable|readable text/i;
const MINOR_CODED = /萝莉|幼女|未成年|少女体态|小女孩|little girl|loli/i;
const SEXUALIZED = /裸露|色情|性暗示|性行为|丰满曲线|布料极少|暴露|娇媚诱惑|爱欲|erotic|sexy|nude/i;
const GORE_OR_SEVERE = /血腥|鲜血|肢解|内脏|露骨伤口|重伤|虐待|gore|dismember|entrails|severe injury/i;

function cleanSpaces(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCssBlocks(text, diagnostics) {
  let result = String(text || "");
  const before = result;
  result = result.replace(/(?:^|\n)\s*[.#][\w-]+\s*\{[\s\S]*?\}\s*/g, "\n");
  result = result.replace(/[.#][\w-]+\s*\{[^{}]*\}/g, " ");
  if (result !== before) diagnostics.removed.push("css");
  return result;
}

function stripNonVisualTaggedBlocks(text, diagnostics) {
  let result = String(text || "");
  const before = result;
  result = result
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<options\b[^>]*>[\s\S]*?<\/options>/gi, "\n")
    .replace(/<disclaimer\b[^>]*>[\s\S]*?<\/disclaimer>/gi, "\n")
    .replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi, "\n")
    .replace(/<StatusPlaceHolderImpl\b[^>]*\/?>/gi, "\n");
  if (result !== before) diagnostics.removed.push("non-visual-tags");
  return result;
}

function stripHiddenBlocks(text, diagnostics) {
  let result = String(text || "");
  const before = result;
  result = result.replace(/<!--[\s\S]*?-->/g, "\n");
  if (result !== before) diagnostics.removed.push("hidden-comment");
  return result;
}

function stripHtmlTags(text, diagnostics) {
  let result = String(text || "");
  const before = result;
  result = result.replace(/<[^>]+>/g, " ");
  if (result !== before) diagnostics.removed.push("html");
  return result;
}

function stripMechanicalLines(text, diagnostics) {
  const lines = String(text || "").split(/\r?\n/);
  const kept = [];
  let removed = false;
  let inMechanicalBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(属性|资源|技能|装备|生命层级|等级|种族|身份|职业|性格|喜爱|外貌特质|衣物装饰|背景故事)\s*[:：]?/.test(trimmed)) {
      inMechanicalBlock = true;
      removed = true;
      continue;
    }
    if (inMechanicalBlock) {
      if (!trimmed) {
        inMechanicalBlock = false;
      }
      removed = true;
      continue;
    }
    if (/^(HP|MP|SP)\s*[:=]|^\s*[力量敏捷体质智力精神]\s*[:=]/i.test(trimmed)) {
      removed = true;
      continue;
    }
    if (/font-family|box-shadow|border-radius|linear-gradient|background:|padding:|margin:|color:\s*#|display:\s*inline-block/i.test(trimmed)) {
      removed = true;
      continue;
    }
    kept.push(line);
  }
  if (removed) diagnostics.removed.push("mechanical-data");
  return kept.join("\n");
}

function stripChoiceAndBoilerplateTail(text, diagnostics) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let removed = false;
  let tailMode = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+[\.、]\s*/.test(trimmed)) {
      tailMode = true;
      removed = true;
      continue;
    }
    if (/^The narrative |^All character actions |^The content is |^The text avoids |^The story |^Readers are |^By adhering |^Depicting harsh environments/i.test(trimmed)) {
      tailMode = true;
      removed = true;
      continue;
    }
    if (tailMode) {
      removed = true;
      continue;
    }
    out.push(line);
  }
  if (removed) diagnostics.removed.push("tail-choices-boilerplate");
  return out.join("\n");
}

export function cleanPromptSource(sourceText) {
  const diagnostics = { removed: [], fallback: false };
  let text = String(sourceText || "");
  text = stripNonVisualTaggedBlocks(text, diagnostics);
  text = stripCssBlocks(text, diagnostics);
  text = stripHiddenBlocks(text, diagnostics);
  text = stripHtmlTags(text, diagnostics);
  text = stripMechanicalLines(text, diagnostics);
  text = stripChoiceAndBoilerplateTail(text, diagnostics);
  text = cleanSpaces(text);
  if (!text) {
    diagnostics.fallback = true;
    diagnostics.removed.push("cleanup-fallback");
    text = cleanSpaces(String(sourceText || "").replace(/<[^>]+>/g, " "));
  }
  return { text, diagnostics };
}

function cleanPromptFragment(value) {
  const source = String(value || "").trim();
  if (!source) return { text: "", diagnostics: { removed: [], fallback: false } };
  return cleanPromptSource(source);
}

export function parseNamedReferences(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
      if (!match) return null;
      return {
        name: match[1].trim(),
        description: match[2].trim(),
      };
    })
    .filter((entry) => entry?.name && entry.description);
}

function normalizeFixedReferences(fixed = {}) {
  return {
    style: String(fixed?.styleText || fixed?.style || "").trim(),
    characters: parseNamedReferences(fixed?.charactersText || fixed?.characters || ""),
    scenes: parseNamedReferences(fixed?.scenesText || fixed?.scenes || ""),
    rawScenes: String(fixed?.scenesText || fixed?.scenes || "").trim(),
  };
}

function getPromptParts(job = {}) {
  return job.promptParts || job || {};
}

function collectJobCharacters(job = {}) {
  const parts = getPromptParts(job);
  return unique([
    ...(Array.isArray(job.characters) ? job.characters : []),
    ...(Array.isArray(parts.characters) ? parts.characters : []),
  ]);
}

function contextsAroundName(text, name) {
  const source = String(text || "");
  const contexts = [];
  const pattern = new RegExp(escapeRegExp(name), "g");
  for (const match of source.matchAll(pattern)) {
    const index = match.index || 0;
    const leftBreak = Math.max(source.lastIndexOf("。", index), source.lastIndexOf("\n", index), source.lastIndexOf("！", index), source.lastIndexOf("？", index));
    const rightCandidates = ["。", "\n", "！", "？"]
      .map((sep) => source.indexOf(sep, index + name.length))
      .filter((value) => value >= 0);
    const rightBreak = rightCandidates.length ? Math.min(...rightCandidates) : source.length;
    contexts.push(source.slice(leftBreak + 1, rightBreak));
  }
  return contexts;
}

export function classifyVisibleCharacters(names, sourceText) {
  const source = String(sourceText || "");
  const visible = [];
  const nonVisual = [];
  for (const name of unique(names)) {
    const contexts = contextsAroundName(source, name);
    const hasVisibleContext = contexts.some((context) => {
      const negatedEntity = /没有实体|并没有实体|无实体|不可见/.test(context);
      const positiveVisible = /出现在|站在|走到|看见|身影|实体出现在/.test(context);
      return !negatedEntity && (!NON_VISUAL_HINTS.test(context) || positiveVisible);
    });
    const hasOnlyNonVisualContexts = contexts.length > 0 && !hasVisibleContext;
    if (hasOnlyNonVisualContexts) {
      nonVisual.push(name);
    } else {
      visible.push(name);
    }
  }
  return { visible, nonVisual };
}

function resolveSceneReferences(fixedRefs, sceneName, cleanedText) {
  if (fixedRefs.scenes.length) {
    const matched = fixedRefs.scenes.filter((entry) => (
      !sceneName
      || entry.name === sceneName
      || String(sceneName).includes(entry.name)
      || String(cleanedText || "").includes(entry.name)
      || fixedRefs.scenes.length === 1
    ));
    return matched.length ? matched : fixedRefs.scenes.slice(0, 1);
  }
  if (fixedRefs.rawScenes) {
    return [{ name: String(sceneName || "场景设定").trim() || "场景设定", description: fixedRefs.rawScenes }];
  }
  return [];
}

function resolveDialoguePolicy(mode, parts, explicitPolicy) {
  if (explicitPolicy) return explicitPolicy;
  if (mode === "comic" && String(parts.dialogueMode || "") === "modelText") return "model-text";
  if (mode === "comic") return "plugin-bubble";
  return "no-text";
}

function compileDraftPrompt(draft) {
  const lines = [];
  if (draft.protectedStyle) lines.push(`风格：${draft.protectedStyle}`);
  lines.push(`画面主体：${draft.visualMoment || draft.cleanedText || draft.sourceText}`);
  if (draft.visibleCharacters.length) lines.push(`可见人物：${draft.visibleCharacters.join("、")}`);
  if (draft.protectedCharacters.length) {
    lines.push(`人物设定：${draft.protectedCharacters.map((entry) => `${entry.name}：${entry.description}`).join("；")}`);
  }
  if (draft.diagnostics.missingCharacters.length) {
    lines.push(`缺外貌人物：${draft.diagnostics.missingCharacters.map((name) => `${name}：无固定外貌参考，保留姓名和当前剧情身份`).join("；")}`);
  }
  if (draft.protectedScenes.length) {
    lines.push(`场景设定：${draft.protectedScenes.map((entry) => `${entry.name}：${entry.description}`).join("；")}`);
  }
  if (draft.actions.length) lines.push(`动作表情：${draft.actions.join("；")}`);
  if (draft.anchors.length) lines.push(`视觉锚点：${draft.anchors.join("；")}`);
  if (draft.dialoguePolicy === "plugin-bubble") {
    lines.push("文字/对白：对白由插件气泡显示，图片中不要生成任何文字、字幕、气泡文字或水印。");
  } else if (draft.dialoguePolicy === "model-text") {
    lines.push(`文字/对白：允许模型绘制明确提供的对白文字：${draft.dialogue.join("；")}`);
  } else {
    lines.push("文字/对白：除非原文明确要求招牌文字，否则不要生成文字、字幕或水印。");
  }
  lines.push("避免：多画面拼贴、错误角色替换、无关人物、乱码文字、血腥露骨细节。");
  return lines.filter(Boolean).join("\n").trim();
}

export function createPromptDraft(input = {}) {
  const sourceText = String(input.sourceText || input.prompt || input.job?.sourceText || input.job?.prompt || "");
  const mode = String(input.mode || input.job?.mode || "single");
  const cleanup = cleanPromptSource(sourceText);
  const fixedRefs = normalizeFixedReferences(input.fixed || input.visualBible?.fixed || input.visualBible || {});
  const job = input.job || {};
  const parts = getPromptParts(job);
  const characters = collectJobCharacters(job);
  const classified = classifyVisibleCharacters(characters, cleanup.text);
  const visibleCharacters = classified.visible;
  const nonVisualCharacters = classified.nonVisual;
  const protectedCharacters = fixedRefs.characters.filter((entry) => visibleCharacters.includes(entry.name));
  const missingCharacters = visibleCharacters.filter((name) => !protectedCharacters.some((entry) => entry.name === name));
  const rawVisualMoment = String(parts.visualMoment || parts.imageDescription || parts.prompt || job.prompt || cleanup.text || sourceText).trim();
  const visualCleanup = cleanPromptFragment(rawVisualMoment);
  const visualMoment = String(visualCleanup.text || cleanup.text || rawVisualMoment || sourceText).trim();
  const sceneName = String(parts.scene || job.scene || input.scene || "").trim();
  const protectedScenes = resolveSceneReferences(fixedRefs, sceneName, cleanup.text);
  const dialogue = Array.isArray(parts.dialogue) ? parts.dialogue.filter(Boolean) : [];
  const dialoguePolicy = resolveDialoguePolicy(mode, parts, input.dialoguePolicy);
  const draft = {
    sourceText,
    cleanedText: cleanup.text,
    mode,
    title: String(job.title || parts.title || "").trim(),
    visualMoment,
    visibleCharacters,
    nonVisualCharacters,
    allCharacterReferences: fixedRefs.characters,
    protectedCharacters,
    protectedScenes,
    protectedStyle: fixedRefs.style,
    sceneName,
    actions: Array.isArray(parts.actions) ? unique(parts.actions.map((item) => cleanPromptFragment(item).text || item)) : [],
    anchors: Array.isArray(parts.anchors) ? unique(parts.anchors.map((item) => cleanPromptFragment(item).text || item)) : [],
    dialogue,
    dialoguePolicy,
    compiledPrompt: "",
    refinedPrompt: "",
    safetyPrompt: "",
    finalPrompt: "",
    riskReport: { checked: false, requiresRewrite: false, items: [] },
    validation: { ok: true, reasons: [] },
    diagnostics: {
      preflight: "compiled",
      cleanup: cleanup.diagnostics,
      visualMomentCleanup: visualCleanup.diagnostics,
      missingCharacters,
      rejectedRefinement: "",
    },
  };
  draft.compiledPrompt = compileDraftPrompt(draft);
  draft.finalPrompt = draft.compiledPrompt;
  return draft;
}

export function createPromptDraftForJob(input = {}) {
  const draft = createPromptDraft(input);
  draft.diagnostics.preflight = "compiled";
  return draft;
}

function extractAnchorTerms(description) {
  return unique(String(description || "")
    .split(/[，,；;。、\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, 4));
}

export function validatePromptCandidate(candidate, draft) {
  const prompt = String(candidate || "").trim();
  const reasons = [];
  if (!prompt) reasons.push("empty-prompt");
  for (const entry of draft?.protectedCharacters || []) {
    if (!prompt.includes(entry.name)) {
      reasons.push(`protected-character:${entry.name}`);
      continue;
    }
    const anchors = extractAnchorTerms(entry.description);
    if (anchors.length && !anchors.some((anchor) => prompt.includes(anchor))) {
      reasons.push(`protected-character-anchor:${entry.name}`);
    }
  }
  for (const entry of draft?.protectedScenes || []) {
    const anchors = [entry.name, ...extractAnchorTerms(entry.description)];
    if (!anchors.some((anchor) => prompt.includes(anchor))) {
      reasons.push(`protected-scene:${entry.name}`);
    }
  }
  if (draft?.dialoguePolicy === "plugin-bubble" && IN_IMAGE_TEXT_RISK.test(prompt)) {
    reasons.push("dialogue-policy:plugin-bubble");
  }
  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function acceptRefinementCandidate(candidate, draft) {
  const validation = validatePromptCandidate(candidate, draft);
  if (!validation.ok) {
    return {
      accepted: false,
      prompt: draft?.compiledPrompt || "",
      diagnostics: { reason: validation.reasons.join(",") },
      validation,
    };
  }
  return {
    accepted: true,
    prompt: String(candidate || "").trim(),
    diagnostics: { reason: "" },
    validation,
  };
}

function findRiskInText(text) {
  const value = String(text || "");
  const categories = [];
  if (MINOR_CODED.test(value) && SEXUALIZED.test(value)) categories.push("sexualized-minor-coded");
  else if (SEXUALIZED.test(value)) categories.push("sexualized");
  if (GORE_OR_SEVERE.test(value)) categories.push("gore-or-severe-harm");
  return categories;
}

export function classifyPromptRisks(draft) {
  const items = [];
  for (const entry of draft?.allCharacterReferences || []) {
    const categories = findRiskInText(`${entry.name} ${entry.description}`);
    if (categories.length) items.push({ source: "character", name: entry.name, categories });
  }
  for (const entry of draft?.protectedScenes || []) {
    const categories = findRiskInText(`${entry.name} ${entry.description}`);
    if (categories.length) items.push({ source: "scene", name: entry.name, categories });
  }
  const actionCategories = findRiskInText([draft?.visualMoment, ...(draft?.actions || []), draft?.compiledPrompt].join(" "));
  if (actionCategories.length) items.push({ source: "action", name: "prompt", categories: actionCategories });
  return {
    checked: true,
    requiresRewrite: items.length > 0,
    items,
  };
}

function sanitizeRiskyText(text) {
  let value = String(text || "");
  value = value
    .replace(/身材娇小却拥有丰满曲线的/g, "")
    .replace(/魅魔萝莉/g, "成年魅魔命定之灵")
    .replace(/萝莉/g, "成年幻想角色")
    .replace(/布料极少的魅魔服饰/g, "设计得体的幻想魅魔服饰")
    .replace(/布料极少/g, "服饰得体")
    .replace(/娇媚诱惑/g, "俏皮神秘")
    .replace(/丰满曲线/g, "清晰轮廓")
    .replace(/裸露|色情|性暗示|性行为/g, "SFW安全");
  if (!/成年|SFW|得体/.test(value)) value += "，成年、SFW、服饰得体";
  return value;
}

export function rewriteRiskyPromptFields(draft, riskReport = null) {
  const risks = riskReport || classifyPromptRisks(draft);
  const riskyCharacterNames = new Set(risks.items.filter((item) => item.source === "character").map((item) => item.name));
  const riskySceneNames = new Set(risks.items.filter((item) => item.source === "scene").map((item) => item.name));
  const next = {
    ...draft,
    allCharacterReferences: (draft?.allCharacterReferences || []).map((entry) => (
      riskyCharacterNames.has(entry.name)
        ? { ...entry, description: sanitizeRiskyText(entry.description) }
        : { ...entry }
    )),
    protectedScenes: (draft?.protectedScenes || []).map((entry) => (
      riskySceneNames.has(entry.name)
        ? { ...entry, description: sanitizeRiskyText(entry.description) }
        : { ...entry }
    )),
    riskReport: risks,
    diagnostics: {
      ...(draft?.diagnostics || {}),
      safety: risks.requiresRewrite ? "targeted-rewrite" : "no-risk",
    },
  };
  const visible = new Set(next.visibleCharacters || []);
  next.protectedCharacters = next.allCharacterReferences.filter((entry) => visible.has(entry.name));
  next.compiledPrompt = compileDraftPrompt(next);
  next.safetyPrompt = next.compiledPrompt;
  next.finalPrompt = next.compiledPrompt;
  next.validation = validatePromptCandidate(next.finalPrompt, next);
  return next;
}

function buildSafeRetryPromptFromParts(parts) {
  return [
    parts.references ? `设定参考：${parts.references}` : "",
    parts.prompt || "",
    "SFW安全版本：弱化并移除色情、裸露、血腥、严重伤害、剥削性或恐怖特写；保留允许的人物身份、构图、动作方向、服装、场景、光影和画风一致性。",
    "画面表达改为非血腥的紧张对峙、保护、闪避、克制动作和戏剧光影，不生成可见鲜血、重伤、肢体损伤或露骨细节。",
  ].filter(Boolean).join("\n");
}

export function createPolicyRetryPromptFromDraft(draft, options = {}) {
  if (!draft) {
    return {
      prompt: buildSafeRetryPromptFromParts({ prompt: String(options.legacyPrompt || "").trim() }),
      diagnostics: { source: "legacy-prompt" },
    };
  }
  const safeDraft = rewriteRiskyPromptFields(draft, draft.riskReport?.checked ? draft.riskReport : classifyPromptRisks(draft));
  const references = [
    safeDraft.visibleCharacters?.length ? `人物：${safeDraft.visibleCharacters.join("、")}` : "",
    safeDraft.protectedScenes?.length ? `场景：${safeDraft.protectedScenes.map((entry) => entry.name).join("、")}` : "",
    safeDraft.protectedStyle ? `风格：${safeDraft.protectedStyle}` : "",
    safeDraft.dialoguePolicy ? `对白：${safeDraft.dialoguePolicy}` : "",
  ].filter(Boolean).join("；");
  const prompt = buildSafeRetryPromptFromParts({
    references,
    prompt: safeDraft.finalPrompt || safeDraft.compiledPrompt || draft.finalPrompt || draft.compiledPrompt,
  });
  return {
    prompt,
    diagnostics: { source: "prompt-draft", safety: safeDraft.diagnostics?.safety || "" },
  };
}
