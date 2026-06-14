import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canUsePolicySafeRetry,
  classifyImageGenerationError,
  createPolicySafeRetryPrompt,
} from "../prompt_compiler.mjs";

test("content policy violation is classified as policy failure", () => {
  const error = {
    error: {
      message: "非常抱歉，生成的图片可能违反了我们的内容政策。如果你认为此判断有误，请重试或修改提示语。",
      type: "invalid_request_error",
      code: "content_policy_violation",
    },
  };

  const classified = classifyImageGenerationError(error);
  assert.equal(classified.errorClass, "policy");
  assert.match(classified.summary, /内容政策|政策/);
  assert.match(classified.rawMessage, /content_policy_violation|内容政策/);
});

test("safe retry prompt keeps subject while reducing sensitive detail", () => {
  const prompt = "齐齐和米特在昏暗巷子里进行血腥厮杀，镜头强调伤口、鲜血和恐怖表情。";
  const rewritten = createPolicySafeRetryPrompt(prompt, {
    visualBibleSummary: "人物：齐齐、米特；场景：城镇巷道；风格：日系动画",
  });

  assert.match(rewritten, /齐齐/);
  assert.match(rewritten, /米特/);
  assert.match(rewritten, /SFW|安全|非血腥/);
  assert.doesNotMatch(rewritten, /绕过|忽略.*政策|bypass/i);
  assert.match(rewritten, /减少|弱化|移除/);
});

test("policy safe retry is capped to one attempt", () => {
  assert.equal(canUsePolicySafeRetry({ errorClass: "policy", policyRetryCount: 0 }), true);
  assert.equal(canUsePolicySafeRetry({ errorClass: "policy", policyRetryCount: 1 }), false);
  assert.equal(canUsePolicySafeRetry({ errorClass: "backend", policyRetryCount: 0 }), false);
});
