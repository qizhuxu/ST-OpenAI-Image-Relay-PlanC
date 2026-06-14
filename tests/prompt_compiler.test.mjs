import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compileImagePrompt,
  createSingleImagePlanFromSource,
  normalizePromptSafetyLevel,
} from "../prompt_compiler.mjs";

const fixed = {
  styleText: "日系动画：清爽二次元线条，干净上色，角色表情明确。",
  charactersText: [
    "齐齐：黑色短发，疲惫但冷静的眼神，轻便冒险者服装，腰间挂着粗制长剑。",
    "米特：高单马尾，紫色长发，紫色眼瞳，气质坚定警惕。",
    "亚丝娜：栗色长发，精致脸庞，气质温婉脆弱。",
  ].join("\n"),
  scenesText: "城镇街道：石板路、窄巷、人群围观，午后暖光。",
};

test("single planner selects a visual target and compiler keeps scoped characters", () => {
  const source = [
    "齐齐拔开圣杯瓶，饮下金色露液后挡在混混与米特之间。",
    "随后他侧身闪避，拽住敌人手腕甩向同伴，回头向米特喊话。",
    "最后齐齐横移半步避开重剑，剑尖斜指地面，冷眼逼退流氓头子。",
  ].join("\n");

  const plan = createSingleImagePlanFromSource(source, { strategy: "climax", fixed });
  assert.equal(plan.mode, "single");
  assert.equal(plan.jobs.length, 1);
  assert.match(plan.jobs[0].prompt, /主体/);
  assert.match(plan.jobs[0].prompt, /齐齐/);
  assert.match(plan.jobs[0].prompt, /米特|流氓头子/);
  assert.doesNotMatch(plan.jobs[0].prompt, /亚丝娜：栗色长发/);
  assert.match(plan.jobs[0].prompt, /构图/);
  assert.match(plan.jobs[0].prompt, /避免/);
});

test("single planner ignores tagged safety disclaimer when selecting visual target", () => {
  const source = [
    "<style>.scene-card{font-size:12px;color:red}</style>",
    "<div class=\"scene-card\">Adult explorer Erin stands beside a quiet library window, holding an unfolded antique map in soft daylight.</div>",
    "<options><option>Open the next menu</option></options>",
    "<disclaimer>请遵守政策，请确保画面安全合规。</disclaimer>",
  ].join("\n");

  const plan = createSingleImagePlanFromSource(source, { strategy: "climax", fixed: {} });
  const moment = plan.selectedTarget.visualMoment;

  assert.match(moment, /Adult explorer Erin/);
  assert.match(moment, /quiet library/);
  assert.doesNotMatch(moment, /disclaimer|遵守政策|安全合规|scene-card|<div|<style|<options/i);
  assert.doesNotMatch(plan.jobs[0].prompt, /disclaimer|遵守政策|安全合规|scene-card|<div|<style|<options/i);
});

test("single planner does not treat lighting words as missing characters", () => {
  const source = "晴朗下午，成年女性探险者艾琳站在安静图书馆窗边，手持地图，柔和自然光。";

  const plan = createSingleImagePlanFromSource(source, { strategy: "climax", fixed: {} });

  assert.match(plan.jobs[0].prompt, /艾琳/);
  assert.doesNotMatch(plan.jobs[0].prompt, /自然光：无固定外貌参考|可见人物：自然光/);
  assert.doesNotMatch(plan.jobs[0].promptDiagnostics.missingCharacters.join(","), /自然光/);
});

test("single compiler keeps visible named characters without fixed references", () => {
  const source = "齐齐在石板街道上横移半步，挡在米特前方，手中的长剑斜指地面，金色药剂瓶在腰间闪光。";
  const fixedWithoutQiQi = {
    ...fixed,
    charactersText: "米特：高高单马尾，紫色长发，身形矫健；高单马尾，紫色长发，紫色眼瞳，气质坚定警惕。",
  };

  const plan = createSingleImagePlanFromSource(source, { strategy: "climax", fixed: fixedWithoutQiQi });
  const job = plan.jobs[0];

  assert.match(job.prompt, /齐齐：无固定外貌参考/);
  assert.match(job.prompt, /米特：高高单马尾/);
  assert.deepEqual(job.promptDiagnostics.missingCharacters, ["齐齐"]);
});

test("comic compiler preserves plugin bubble policy without asking model to draw text", () => {
  const compiled = compileImagePrompt({
    mode: "comic",
    fixed,
    job: {
      title: "第 1 格",
      characters: ["齐齐", "米特"],
      promptParts: {
        shot: "中景",
        visualMoment: "齐齐挡在米特前方，回头露出轻松笑意。",
        actions: ["齐齐跨步挡住敌人", "米特握紧长剑"],
        anchors: ["金色圣杯瓶", "街道对峙"],
        dialogue: ["齐齐：想从后面偷袭？没门！"],
        dialogueMode: "bubble",
      },
    },
  });

  assert.match(compiled.prompt, /不要在图片中出现任何文字/);
  assert.match(compiled.prompt, /对白由插件气泡显示/);
  assert.doesNotMatch(compiled.prompt, /绘制清晰可读的中文对白气泡/);
});

test("safety level normalizes invalid values to standard", () => {
  assert.equal(normalizePromptSafetyLevel("loose"), "loose");
  assert.equal(normalizePromptSafetyLevel("strict"), "strict");
  assert.equal(normalizePromptSafetyLevel("unknown"), "standard");
});
