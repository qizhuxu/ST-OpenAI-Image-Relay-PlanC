import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptRefinementCandidate,
  classifyPromptRisks,
  cleanPromptSource,
  createPolicyRetryPromptFromDraft,
  createPromptDraft,
  createPromptDraftForJob,
  rewriteRiskyPromptFields,
  validatePromptCandidate,
} from "../prompt_preflight.mjs";

const fixed = {
  styleText: "写实电影：真实摄影质感，阴冷自然光，压抑的中世纪底层劳作区氛围。",
  charactersText: [
    "齐齐：黑色短发，黑框眼镜，廉价黑色防寒服，神情平静而谨慎。",
    "尼娅：棕色短发，灰绿色眼睛，灰色粗麻长裙，手背红肿，神情倔强又痛苦。",
    "莉莉丝：身材娇小却拥有丰满曲线的魅魔萝莉，粉色长发，漆黑盘角，黑色心形尾巴，布料极少的魅魔服饰，气质娇媚诱惑。",
  ].join("\n"),
  scenesText: "下层马厩区：半露天城堡马厩，腐朽木柱，发黑草料，破旧木板推车，阴冷浑浊的光线。",
};

test("cleanPromptSource removes CSS HTML hidden reasoning choices and safety boilerplate", () => {
  const source = [
    "复兴纪元488年 @ 城堡下层马厩区",
    ".scene-card { color: #fff; font-family: serif; }",
    "<div class=\"scene-card\">尼娅捂着红肿的手背蹲在泥水里，齐齐停下脚步注视她。</div>",
    "<!-- charThink: Step1_核心定位: 姓名: 尼娅 HP = 521 MP = 300 -->",
    "属性:\n  力量: 5\n资源:\n  HP: 521",
    "1. 走上前去包扎伤口",
    "2. 冷眼旁观她受伤",
    "The narrative explores survival and resilience within a strictly rule-based fantasy setting.",
  ].join("\n");

  const cleaned = cleanPromptSource(source);

  assert.match(cleaned.text, /尼娅捂着红肿的手背/);
  assert.match(cleaned.text, /齐齐停下脚步/);
  assert.doesNotMatch(cleaned.text, /\.scene-card|font-family|<div|charThink|HP: 521|走上前去|The narrative explores/);
  assert.ok(cleaned.diagnostics.removed.length >= 4);
});

test("createPromptDraft cleans inline HTML style options and disclaimer from job visual moment", () => {
  const polluted = [
    "<style>.scene-card{color:red}</style>",
    "<div>Adult explorer Erin stands in a quiet library, blue hair, white cloak, holding an unfolded antique map.</div>",
    "<options>1. irrelevant option</options>",
    "<disclaimer>safety boilerplate template</disclaimer>",
  ].join("");

  const draft = createPromptDraft({
    sourceText: polluted,
    mode: "single",
    job: {
      promptParts: {
        visualMoment: polluted,
        actions: ["holding an unfolded antique map"],
        characters: [],
        scene: "quiet library",
      },
    },
  });

  assert.match(draft.finalPrompt, /Adult explorer Erin/);
  assert.match(draft.finalPrompt, /quiet library/);
  assert.match(draft.finalPrompt, /holding an unfolded antique map/);
  assert.doesNotMatch(draft.cleanedText, /<style|<\/div>|\.scene-card|irrelevant option|safety boilerplate/i);
  assert.doesNotMatch(draft.finalPrompt, /<style|<\/div>|\.scene-card|<options>|irrelevant option|<disclaimer>|safety boilerplate/i);
});

test("createPromptDraft separates visible and non-visual characters and diagnoses missing references", () => {
  const source = [
    "齐齐在马厩深处停下脚步，看着尼娅因为木刺扎入手背而蹲在泥水里。",
    "他在脑海中说：'莉莉丝，扫描这附近。'",
    "莉莉丝娇俏的笑声只在意识空间里回荡，并没有实体出现在马厩中。",
  ].join("\n");

  const draft = createPromptDraft({
    sourceText: source,
    mode: "single",
    fixed,
    job: {
      characters: ["齐齐", "尼娅", "莉莉丝", "老哈克"],
      promptParts: {
        visualMoment: "尼娅捂着受伤手背蹲在泥水里，齐齐停步注视她。",
        characters: ["齐齐", "尼娅", "莉莉丝", "老哈克"],
        scene: "下层马厩区",
      },
    },
  });

  assert.deepEqual(draft.visibleCharacters, ["齐齐", "尼娅", "老哈克"]);
  assert.deepEqual(draft.nonVisualCharacters, ["莉莉丝"]);
  assert.match(draft.compiledPrompt, /齐齐/);
  assert.match(draft.compiledPrompt, /尼娅/);
  assert.doesNotMatch(draft.compiledPrompt, /莉莉丝：身材娇小|魅魔萝莉|布料极少/);
  assert.deepEqual(draft.diagnostics.missingCharacters, ["老哈克"]);
});

test("validatePromptCandidate rejects refinement that loses protected fields or violates bubble policy", () => {
  const draft = createPromptDraft({
    sourceText: "尼娅在下层马厩区捂着手背，齐齐停步注视她。",
    mode: "comic",
    fixed,
    dialoguePolicy: "plugin-bubble",
    job: {
      characters: ["齐齐", "尼娅"],
      promptParts: {
        visualMoment: "尼娅捂着手背蹲在泥水里，齐齐停步注视。",
        characters: ["齐齐", "尼娅"],
        scene: "下层马厩区",
        dialogue: ["齐齐：别动。"],
        dialogueMode: "bubble",
      },
    },
  });

  const bad = validatePromptCandidate("一个女孩在室内哭泣，画面中绘制清晰中文对白气泡。", draft);
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join(","), /protected-character|protected-scene|dialogue-policy/);

  const accepted = acceptRefinementCandidate("一个女孩在室内哭泣，画面中绘制清晰中文对白气泡。", draft);
  assert.equal(accepted.accepted, false);
  assert.equal(accepted.prompt, draft.compiledPrompt);
  assert.match(accepted.diagnostics.reason, /protected-character|protected-scene|dialogue-policy/);
});

test("classifyPromptRisks and rewriteRiskyPromptFields sanitize only risky fields", () => {
  const draft = createPromptDraft({
    sourceText: "齐齐和尼娅在下层马厩区对峙，莉莉丝只在意识中说话。",
    mode: "single",
    fixed,
    job: {
      characters: ["齐齐", "尼娅", "莉莉丝"],
      promptParts: {
        visualMoment: "尼娅捂着手背蹲在泥水里，齐齐停步注视。",
        characters: ["齐齐", "尼娅", "莉莉丝"],
        scene: "下层马厩区",
      },
    },
  });

  const risks = classifyPromptRisks(draft);
  assert.equal(risks.requiresRewrite, true);
  assert.equal(risks.items.some((item) => item.source === "character" && item.name === "莉莉丝"), true);

  const rewritten = rewriteRiskyPromptFields(draft, risks);
  const lilith = rewritten.allCharacterReferences.find((entry) => entry.name === "莉莉丝");
  const niya = rewritten.allCharacterReferences.find((entry) => entry.name === "尼娅");

  assert.match(lilith.description, /粉色长发/);
  assert.match(lilith.description, /漆黑盘角/);
  assert.match(lilith.description, /心形尾巴/);
  assert.match(lilith.description, /成年|SFW|得体/);
  assert.doesNotMatch(lilith.description, /萝莉|布料极少|诱惑|丰满曲线/);
  assert.match(niya.description, /棕色短发/);
  assert.match(rewritten.compiledPrompt, /下层马厩区/);
});

test("createPolicyRetryPromptFromDraft preserves draft anchors and falls back for legacy jobs", () => {
  const draft = createPromptDraft({
    sourceText: "尼娅捂着手背，齐齐停步注视。",
    mode: "single",
    fixed,
    job: {
      characters: ["齐齐", "尼娅"],
      promptParts: {
        visualMoment: "尼娅捂着红肿手背蹲在泥水里，齐齐停步注视。",
        characters: ["齐齐", "尼娅"],
        scene: "下层马厩区",
        actions: ["捂着手背", "停步注视"],
      },
    },
  });

  const retry = createPolicyRetryPromptFromDraft(draft);
  assert.match(retry.prompt, /齐齐/);
  assert.match(retry.prompt, /尼娅/);
  assert.match(retry.prompt, /下层马厩区/);
  assert.match(retry.prompt, /SFW|安全|非血腥/);
  assert.doesNotMatch(retry.prompt, /bypass|ignore policy|绕过/iu);
  assert.equal(retry.diagnostics.source, "prompt-draft");

  const legacy = createPolicyRetryPromptFromDraft(null, { legacyPrompt: "齐齐和尼娅在马厩里发生冲突。" });
  assert.match(legacy.prompt, /齐齐和尼娅/);
  assert.equal(legacy.diagnostics.source, "legacy-prompt");
});

test("createPromptDraftForJob keeps preflight diagnostics for multi and comic jobs", () => {
  const multi = createPromptDraftForJob({
    mode: "multi",
    sourceText: "齐齐经过尼娅身边，尼娅手背受伤。",
    fixed,
    job: {
      mode: "multi",
      title: "受伤瞬间",
      characters: ["齐齐", "尼娅"],
      promptParts: {
        visualMoment: "尼娅捂着红肿手背蹲在泥水里，齐齐停下脚步。",
        characters: ["齐齐", "尼娅"],
        scene: "下层马厩区",
      },
    },
  });

  assert.equal(multi.mode, "multi");
  assert.match(multi.finalPrompt, /尼娅/);
  assert.match(multi.diagnostics.preflight, /compiled/);

  const comic = createPromptDraftForJob({
    mode: "comic",
    sourceText: "齐齐对尼娅说话。",
    fixed,
    dialoguePolicy: "plugin-bubble",
    job: {
      mode: "comic",
      title: "低声交谈",
      characters: ["齐齐", "尼娅"],
      promptParts: {
        visualMoment: "齐齐蹲下看向尼娅受伤的手背。",
        characters: ["齐齐", "尼娅"],
        scene: "下层马厩区",
        dialogue: ["齐齐：别动。"],
        dialogueMode: "bubble",
      },
    },
  });

  assert.equal(comic.mode, "comic");
  assert.equal(comic.dialoguePolicy, "plugin-bubble");
  assert.doesNotMatch(comic.finalPrompt, /绘制清晰中文对白|draw readable dialogue/i);
  assert.match(comic.diagnostics.preflight, /compiled/);
});
