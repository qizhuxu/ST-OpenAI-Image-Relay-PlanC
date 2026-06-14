# Prompt Quality Samples

Change: `release-hardening-and-real-world-validation`

These samples are dry-run evidence from `prompt_compiler.mjs`. They do not invoke an image backend and do not commit generated image bytes.

## Evaluation Rubric

| Dimension | Pass Signal | Problem Signal |
| --- | --- | --- |
| Character consistency | Fixed appearance, identity, clothing, and role-card Visual Bible traits are present and not contradicted. | Missing user appearance, mixed card data, changed hair/eyes/clothing without source reason. |
| Scene consistency | Location, time, props, atmosphere, and key action match the source text and active scene library. | Generic background, wrong location, lost props, or scene entries from another card. |
| Prompt clarity | Prompt is concrete, image-oriented, and separated from RP/system noise. | Vague adjectives, conversational text, hidden reasoning, unreadable instructions, or no clear subject/action. |
| Flow provenance | Compiled prompt, optional refinement, safety rewrite, and final backend prompt are distinguishable. | Cannot tell which text was sent to backend or whether safety/refinement changed it. |
| Policy behavior | Retry/safety rewrite removes sensitive risk while preserving allowed visual details. | Retry erases identity/scene, keeps policy-sensitive content, or loops without visible status. |

## Shared Visual Bible Fixtures

```text
Style:
Cinematic Story Illustration: painterly fantasy realism, clean composition, expressive faces, soft rim light, no in-image text.

Characters:
齐齐: black-framed glasses, cheap black winter coat, slim young man, calm calculating gaze, black sneakers.
尼娅: short messy brown hair, gray-green eyes, thin malnourished build, rough gray linen dress, red swollen hands.
亚丝娜: long chestnut hair, clear amber-brown eyes, white-and-red fantasy swordswoman outfit, slender athletic posture.
米特: short dark hair, practical adventurer cloak, compact leather armor, alert expression, small dagger at waist.

Scenes:
下层马厩区: rotten wooden posts, blackened straw, muddy ground, old cart, dim light through broken roof cloth, oppressive labor atmosphere.
雨后城镇屋顶: wet roof tiles, misty alley below, reflected lantern light, cool night air, distant clock tower silhouette.
```

## Sample 1: Single Image

- Date: 2026-06-14
- Entry path: manual/message-button equivalent dry run
- Settings snapshot:
  - Role-card scope: `ST-OpenAI-Image-Relay:visual-scope:character-card:avatar_avatar_release-a.png`
  - Generation mode: single
  - Built-in style: Cinematic Story Illustration
  - Auto extraction: not used
  - Refinement: not used in dry run
  - Safety rewrite: not used in dry run
  - Backend mode/model: not invoked
- Source text:
  ```text
  齐齐停在下层马厩区的破旧木板推车旁。他看见尼娅蹲在泥水里捂着被木刺扎伤的手背，毛躁棕色短发贴在额头，灰绿色眼睛里含着倔强和疼痛。腐朽木柱、发黑草料和役马阴影围住两人，缝隙中的冷光落在齐齐的黑框眼镜上。
  ```
- Resolved Visual Bible summary:
  ```text
  activeStyle=Cinematic Story Illustration
  activeScene=下层马厩区
  confirmedCharacters=齐齐, 尼娅, 亚丝娜, 米特
  storageSource=character-card
  ```
- Local compiled prompt:
  ```text
  风格与质感：Cinematic Story Illustration: painterly fantasy realism, clean composition, expressive faces, soft rim light, no in-image text.
  主体：出场人物 齐齐停、他看见尼娅蹲、疼痛、役马阴影围住两人、齐齐、尼娅、亚丝娜、米特；本图画面聚焦于齐齐停在下层马厩区的破旧木板推车旁...
  人物设定：齐齐：black-framed glasses...；尼娅：short messy brown hair...；亚丝娜：long chestnut hair...；米特：short dark hair...
  场景光影：下层马厩区: rotten wooden posts, blackened straw, muddy ground, old cart...
  文字/对白：除非原提示明确要求招牌或界面文字，否则不要生成任何文字、字幕或水印。
  ```
- Optional refined prompt:
  ```text
  N/A; release sample intentionally records local compiler output before optional LLM refinement.
  ```
- Safety rewrite output:
  ```text
  N/A; no policy/safety rewrite was triggered for this dry run.
  ```
- Final backend prompt or dry-run equivalent:
  ```text
  Same as local compiled prompt.
  ```
- Diagnostics:
  ```text
  mode=single
  strategy=climax
  scopedCharacters=齐齐, 尼娅, 亚丝娜, 米特
  missingCharacters=齐齐停, 他看见尼娅蹲, 疼痛, 役马阴影围住两人
  imageTextPolicy=no-text
  ```
- Result reference: dry run only; no generated image.
- Evaluation:
  - Character consistency: PASS with caveat. Fixed appearance for named characters is present.
  - Scene consistency: PASS. The active stable scene is injected.
  - Prompt clarity: PASS with improvement. The image moment is concrete, but diagnostic candidate extraction has false positives.
  - Flow provenance: PASS. Compiled and final dry-run prompt are distinguishable.
  - Policy behavior: N/A.
- Decision: PASS with non-blocking improvement
- Notes: The compiler still over-detects some Chinese verb phrases as `missingCharacters`. This is noisy diagnostics, not a release blocker because fixed character descriptions are still present and backend prompt remains usable.

## Sample 2: Automatic Whole-Message

- Date: 2026-06-14
- Entry path: automatic whole-message dry run
- Settings snapshot:
  - Role-card scope: `ST-OpenAI-Image-Relay:visual-scope:character-card:avatar_avatar_release-b.png`
  - Generation mode: single from whole message
  - Built-in style: Cinematic Story Illustration
  - Auto extraction: not used in sample
  - Refinement: not used in dry run
  - Safety rewrite: not used in dry run
  - Backend mode/model: not invoked
- Source text:
  ```text
  雨后的城镇屋顶上，亚丝娜握剑站在前景，白红服装被潮湿夜风轻轻掀起。米特蹲在屋脊另一侧，披风贴着肩膀，目光警惕地望向雾气中的钟楼。两人没有说话，只用手势确认下一步潜入路线，湿瓦反射着巷子里的灯光。
  ```
- Resolved Visual Bible summary:
  ```text
  activeStyle=Cinematic Story Illustration
  activeScene=雨后城镇屋顶
  confirmedCharacters=亚丝娜, 米特
  storageSource=character-card
  ```
- Local compiled prompt:
  ```text
  风格与质感：Cinematic Story Illustration: painterly fantasy realism, clean composition, expressive faces, soft rim light, no in-image text.
  主体：出场人物 米特蹲、雾气中的钟楼、亚丝娜、米特；本图画面聚焦于雨后的城镇屋顶上，亚丝娜握剑站在前景...
  人物设定：亚丝娜：long chestnut hair, clear amber-brown eyes, white-and-red fantasy swordswoman outfit...；米特：short dark hair, practical adventurer cloak...
  场景光影：雨后城镇屋顶: wet roof tiles, misty alley below, reflected lantern light, cool night air, distant clock tower silhouette.
  ```
- Optional refined prompt:
  ```text
  N/A; release sample intentionally records local compiler output before optional LLM refinement.
  ```
- Safety rewrite output:
  ```text
  N/A; no policy/safety rewrite was triggered for this dry run.
  ```
- Final backend prompt or dry-run equivalent:
  ```text
  Same as local compiled prompt.
  ```
- Diagnostics / workflow status:
  ```text
  mode=single
  strategy=final
  scopedCharacters=亚丝娜, 米特
  missingCharacters=米特蹲, 雾气中的钟楼
  imageTextPolicy=no-text
  Browser L2 status surface: 自动队列：空闲; automatic workflow controls visible.
  ```
- Result reference: dry run only; no generated image.
- Evaluation:
  - Character consistency: PASS with caveat. The final prompt includes both fixed appearances.
  - Scene consistency: PASS. The active rooftop scene is present.
  - Prompt clarity: PASS with improvement. Same diagnostic false-positive issue as sample 1.
  - Flow provenance: PASS.
  - Policy behavior: N/A.
- Decision: PASS with non-blocking improvement
- Notes: Automatic whole-message UI status was browser-verified; real backend generation was intentionally skipped to avoid account/policy noise during the release gate.

## Sample 3: Comic Dialogue / Policy Retry Adjacent

- Date: 2026-06-14
- Entry path: comic dialogue + mocked policy retry dry run
- Settings snapshot:
  - Role-card scope: `ST-OpenAI-Image-Relay:visual-scope:character-card:avatar_avatar_release-b.png`
  - Generation mode: comic
  - Built-in style: Cinematic Story Illustration
  - Auto extraction: not used in sample
  - Refinement: not used in dry run
  - Safety rewrite: policy-safe retry dry run
  - Backend mode/model: not invoked
- Source text:
  ```text
  亚丝娜在湿漉漉的屋顶前景回头示意，米特半蹲在远侧屋脊，远处钟楼被雾气遮住。
  ```
- Dialogue metadata / policy trigger:
  ```text
  dialogueMode=bubble
  dialogue=亚丝娜：别出声，跟紧我。 / 米特：我看见巡逻灯了。
  mocked error code=content_policy_violation
  ```
- Resolved Visual Bible summary:
  ```text
  activeStyle=Cinematic Story Illustration
  activeScene=雨后城镇屋顶
  confirmedCharacters=亚丝娜, 米特
  ```
- Local compiled prompt:
  ```text
  风格与质感：Cinematic Story Illustration...
  主体：出场人物 亚丝娜、米特；本格画面聚焦于亚丝娜在湿漉漉的屋顶前景回头示意，米特半蹲在远侧屋脊...
  人物设定：亚丝娜：long chestnut hair...；米特：short dark hair...
  镜头构图：分格内主体清晰，人物站位左右/前后关系明确，留出对白气泡叠加空间但图片本身不承载文字。
  文字/对白：不要在图片中出现任何文字、对白气泡或字幕；对白由插件气泡显示... Do not render readable text; plugin bubble overlay will display dialogue.
  ```
- Optional refined prompt:
  ```text
  N/A; release sample intentionally records local compiler output before optional LLM refinement.
  ```
- Safety rewrite or retry prompt:
  ```text
  设定参考：亚丝娜、米特固定外貌；雨后城镇屋顶；Cinematic Story Illustration。
  [compiled prompt preserved]
  SFW安全版本：减少、弱化并移除血腥、伤口、露骨伤害、色情、裸露、剥削性或恐怖细节；保留允许的人物身份、构图、动作方向、服装、场景和画风一致性。
  画面表达改为非血腥的紧张对峙、保护、闪避、克制动作和戏剧光影，不生成可见鲜血、重伤、肢体损伤或恐怖特写。
  ```
- Final backend prompt or dry-run equivalent:
  ```text
  Policy-safe retry prompt above.
  ```
- Diagnostics / retry status:
  ```text
  mode=comic
  scopedCharacters=亚丝娜, 米特
  missingCharacters=[]
  dialogueMode=bubble
  dialogueEnabled=true
  imageTextPolicy=plugin-bubble
  policyError.errorClass=policy
  policyError.summary=图片后端拒绝：可能触发内容政策，请使用安全重试或修改提示词。
  ```
- Result reference: dry run only; browser history injected one mocked policy failure and displayed `安全重试`.
- Evaluation:
  - Character consistency: PASS. Fixed appearances are preserved.
  - Scene consistency: PASS. Rooftop scene and anchors are preserved.
  - Prompt clarity: PASS. Dialogue is clearly assigned to plugin bubble overlay, not image text.
  - Flow provenance: PASS. Compiled prompt, policy classification, retry prompt, and final dry-run prompt are distinguishable.
  - Policy behavior: PASS. Retry is conservative and does not erase identity/scene.
- Decision: PASS
- Notes: This is the cleanest sample in the set; no missing-character diagnostics.

## Blockers vs Improvements

| Type | Summary | Evidence | Proposed Follow-up |
| --- | --- | --- | --- |
| Blocker | None remaining from prompt-quality samples. | All three samples preserve required fixed character/scene/style data and prompt provenance. | N/A |
| Improvement | Chinese visible-character extraction is too broad and can mark verb phrases or location phrases as missing characters. | Samples 1 and 2 reported `齐齐停`, `他看见尼娅蹲`, `疼痛`, `米特蹲`, `雾气中的钟楼`. | Future OpenSpec change: tighten Chinese name extraction using known Visual Bible names, punctuation boundaries, and stopword/action filters. |
| Improvement | Real image quality still depends on backend/model behavior. | Release samples are compiler dry runs, not image outputs. | Future validation with a stable backend account/model and saved local image references outside git. |
