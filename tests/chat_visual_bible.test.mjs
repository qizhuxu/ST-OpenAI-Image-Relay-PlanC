import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILT_IN_STYLE_PRESETS,
  applyAutomaticVisualExtraction,
  compileImagePrompt,
  createChatVisualScopeKey,
  createMemoryVisualScopeStore,
  createSingleImagePlanFromSource,
  confirmCharacterCandidatesIntoScope,
  formatBuiltInStyleLibrary,
  mergeBuiltInStylePresets,
  normalizeVisualExtractionSettings,
  loadChatVisualScope,
  resolvePersonaVisualCandidates,
  resolveChatVisualBible,
  saveChatVisualScopePatch,
} from "../prompt_compiler.mjs";

function makeContext(chatId, chatFile = `${chatId}.jsonl`, overrides = {}) {
  return {
    chatId,
    characterName: "HeroCard",
    characterAvatar: "hero.png",
    chatFile,
    ...overrides,
  };
}

test("character-card visual scopes follow card identity across chats and isolate different cards", () => {
  const store = createMemoryVisualScopeStore();
  const cardAChatOne = makeContext("chat-a-1", "chapter-one.jsonl", {
    characterName: "CardA",
    characterAvatar: "card-a.png",
  });
  const cardAChatTwo = makeContext("chat-a-2", "chapter-two.jsonl", {
    characterName: "CardA",
    characterAvatar: "card-a.png",
  });
  const cardB = makeContext("chat-b", "chapter-one.jsonl", {
    characterName: "CardB",
    characterAvatar: "card-b.png",
  });
  const settings = {
    characterAppearance: "Legacy: old global cloak",
    sceneLibrary: "LegacyRoom: old global room",
    styleLibrary: "LegacyStyle: old global brush",
    styleActive: "LegacyStyle",
    sceneActive: "LegacyRoom",
  };

  assert.equal(createChatVisualScopeKey(cardAChatOne), createChatVisualScopeKey(cardAChatTwo));
  assert.notEqual(createChatVisualScopeKey(cardAChatOne), createChatVisualScopeKey(cardB));

  saveChatVisualScopePatch({
    context: cardAChatOne,
    store,
    patch: {
      characterAppearance: "Mira: silver braid and blue coat",
      sceneLibrary: "Clocktower: rainy tower hall",
      sceneActive: "Clocktower",
      confirmedCharacters: ["Mira"],
    },
  });

  const scopeA1 = loadChatVisualScope({ context: cardAChatOne, settings, store });
  const scopeA2 = loadChatVisualScope({ context: cardAChatTwo, settings, store });
  const scopeB = loadChatVisualScope({ context: cardB, settings, store });

  assert.match(scopeA1.values.characterAppearance, /silver braid/);
  assert.match(scopeA2.values.characterAppearance, /silver braid/);
  assert.match(scopeA2.values.sceneLibrary, /rainy tower hall/);
  assert.deepEqual(scopeA2.values.confirmedCharacters, ["Mira"]);

  assert.doesNotMatch(scopeB.values.characterAppearance, /silver braid/);
  assert.doesNotMatch(scopeB.values.sceneLibrary, /rainy tower hall/);
  assert.equal(scopeB.values.characterAppearance, "");
  assert.equal(scopeB.values.sceneLibrary, "");
  assert.equal(scopeB.sources.characterAppearance, "empty");

  assert.match(settings.characterAppearance, /old global cloak/, "saving card scope must not mutate legacy settings");
});

test("character-card visual scope key keeps id and name priority when no avatar exists", () => {
  const idKey = createChatVisualScopeKey({
    chatId: "chat-a",
    characterCardKey: "42",
    characterId: "42",
    characterName: "FallbackName",
  });
  const nameKey = createChatVisualScopeKey({
    chatId: "chat-b",
    characterCardKey: "FallbackName",
    characterName: "FallbackName",
  });

  assert.match(idKey, /character-card:id_42$/);
  assert.match(nameKey, /character-card:name_FallbackName$/);
  assert.doesNotMatch(idKey, /chat-a/);
  assert.doesNotMatch(nameKey, /chat-b/);
});

test("new character card without a library does not fall back to legacy or old chat scope values", () => {
  const oldChatScopeKey = "ST-OpenAI-Image-Relay:visual-scope:old-chat|old-file-jsonl|card-c|card-c-png";
  const store = createMemoryVisualScopeStore({
    [oldChatScopeKey]: {
      characterAppearance: "OldChat: should not appear",
      sceneLibrary: "OldRoom: should not appear",
      sceneActive: "OldRoom",
      confirmedCharacters: ["OldChat"],
    },
  });
  const cardC = makeContext("old-chat", "old-file.jsonl", {
    characterName: "CardC",
    characterAvatar: "card-c.png",
  });
  const settings = {
    characterAppearance: "Legacy: should not appear",
    sceneLibrary: "LegacyRoom: should not appear",
    sceneActive: "LegacyRoom",
    styleLibrary: "LegacyStyle: should not appear",
    styleActive: "LegacyStyle",
    confirmedCharacters: ["Legacy"],
  };

  const scope = loadChatVisualScope({ context: cardC, settings, store });

  assert.equal(scope.values.characterAppearance, "");
  assert.equal(scope.values.sceneLibrary, "");
  assert.equal(scope.values.sceneActive, "");
  assert.equal(scope.values.styleLibrary, "");
  assert.equal(scope.values.styleActive, "");
  assert.deepEqual(scope.values.confirmedCharacters, []);
  assert.equal(scope.sources.characterAppearance, "empty");
  assert.equal(scope.sources.sceneLibrary, "empty");
  assert.equal(scope.sources.styleLibrary, "empty");
});

test("explicitly cleared chat visual libraries do not fall back to legacy values", () => {
  const store = createMemoryVisualScopeStore();
  const context = makeContext("cleared-chat");
  const settings = {
    characterAppearance: "Legacy: old global cloak",
    sceneLibrary: "LegacyRoom: old global room",
    sceneActive: "LegacyRoom",
    confirmedCharacters: ["Legacy"],
  };

  saveChatVisualScopePatch({
    context,
    store,
    patch: {
      characterAppearance: "",
      sceneLibrary: "",
      sceneActive: "",
      confirmedCharacters: [],
    },
  });

  const scope = loadChatVisualScope({ context, settings, store });
  assert.equal(scope.values.characterAppearance, "");
  assert.equal(scope.values.sceneLibrary, "");
  assert.equal(scope.values.sceneActive, "");
  assert.deepEqual(scope.values.confirmedCharacters, []);
  assert.equal(scope.sources.characterAppearance, "empty");
  assert.equal(scope.sources.sceneLibrary, "empty");
  assert.equal(scope.sources.confirmedCharacters, "empty");
});

test("single multi and comic prompts share the same current chat Visual Bible", () => {
  const store = createMemoryVisualScopeStore();
  const context = makeContext("visual-chat");
  saveChatVisualScopePatch({
    context,
    store,
    patch: {
      characterAppearance: [
        "Mira: silver braid, blue travel coat, brass lantern",
        "Sol: black hair, red scarf, compact crossbow",
      ].join("\n"),
      styleLibrary: "Noir: watercolor noir, soft rim light",
      styleActive: "Noir",
      sceneLibrary: "Clocktower: rainy tower hall, brass gears, tall windows",
      sceneActive: "Clocktower",
    },
  });

  const visualBible = resolveChatVisualBible({
    context,
    settings: {},
    store,
    sourceText: "Mira raises the lantern while Sol guards the clocktower stairs.",
  });

  const single = createSingleImagePlanFromSource("Mira raises the lantern in the tower hall.", {
    strategy: "climax",
    visualBible,
  }).jobs[0].prompt;
  const multi = compileImagePrompt({
    mode: "multi",
    visualBible,
    job: {
      characters: ["Mira", "Sol"],
      promptParts: {
        visualMoment: "Mira and Sol cross the tower hall.",
        characters: ["Mira", "Sol"],
        actions: ["Mira lifts the lantern", "Sol watches the stairwell"],
      },
    },
  }).prompt;
  const comic = compileImagePrompt({
    mode: "comic",
    visualBible,
    job: {
      characters: ["Mira", "Sol"],
      promptParts: {
        visualMoment: "Mira points the lantern toward Sol.",
        characters: ["Mira", "Sol"],
        dialogue: ["Mira: Hold the line"],
        dialogueMode: "bubble",
      },
    },
  }).prompt;

  for (const prompt of [single, multi, comic]) {
    assert.match(prompt, /silver braid/);
    assert.match(prompt, /red scarf/);
    assert.match(prompt, /rainy tower hall/);
    assert.match(prompt, /watercolor noir/);
  }

  assert.equal(visualBible.diagnostics.scopeKey, createChatVisualScopeKey(context));
  assert.equal(visualBible.diagnostics.sourceLabels.characterAppearance, "character-card library");
});

test("missing fixed appearances stay visible and are diagnosed", () => {
  const store = createMemoryVisualScopeStore();
  const context = makeContext("missing-ref");
  saveChatVisualScopePatch({
    context,
    store,
    patch: {
      characterAppearance: "Sol: black hair, red scarf",
      sceneLibrary: "Clocktower: rainy tower hall",
      sceneActive: "Clocktower",
    },
  });
  const visualBible = resolveChatVisualBible({
    context,
    store,
    settings: {},
    sourceText: "Mira stands beside Sol.",
  });

  const compiled = compileImagePrompt({
    mode: "multi",
    visualBible,
    job: {
      characters: ["Mira", "Sol"],
      promptParts: {
        visualMoment: "Mira stands beside Sol in the tower hall.",
        characters: ["Mira", "Sol"],
      },
    },
  });

  assert.match(compiled.prompt, /Mira/);
  assert.match(compiled.prompt, /no fixed appearance reference/i);
  assert.match(compiled.prompt, /Sol/);
  assert.deepEqual(compiled.diagnostics.missingCharacters, ["Mira"]);
});

test("user persona becomes confirmable candidate and saves to current character-card profile", () => {
  const store = createMemoryVisualScopeStore();
  const chatA = {
    ...makeContext("persona-a", "persona-a.jsonl", {
      characterName: "PersonaCardA",
      characterAvatar: "persona-a.png",
    }),
    userName: "齐齐",
    personaName: "齐齐",
  };
  const chatB = {
    ...makeContext("persona-b", "persona-b.jsonl", {
      characterName: "PersonaCardB",
      characterAvatar: "persona-b.png",
    }),
    userName: "齐齐",
    personaName: "齐齐",
  };

  const visualBible = resolveChatVisualBible({
    context: chatA,
    settings: {
      characterAppearance: "亚丝娜: chestnut hair, white-and-red knight outfit",
    },
    store,
    sourceText: "齐齐挡在米特前方，抬起长剑逼退流氓头子。",
  });

  const candidates = resolvePersonaVisualCandidates({
    context: chatA,
    sourceText: "齐齐挡在米特前方，抬起长剑逼退流氓头子。",
    visualBible,
  });

  assert.equal(candidates[0].name, "齐齐");
  assert.equal(candidates[0].source, "story-derived");
  assert.match(candidates[0].text, /齐齐|长剑|主角/);

  confirmCharacterCandidatesIntoScope({
    context: chatA,
    store,
    candidates: [
      {
        ...candidates[0],
        text: "black short hair, tired calm eyes, light adventurer outfit, long sword at waist",
        selected: true,
      },
    ],
  });

  const scopeA = loadChatVisualScope({ context: chatA, settings: {}, store });
  const scopeB = loadChatVisualScope({ context: chatB, settings: {}, store });

  assert.match(scopeA.values.characterAppearance, /齐齐/);
  assert.match(scopeA.values.characterAppearance, /long sword/);
  assert.doesNotMatch(scopeB.values.characterAppearance, /long sword/);
});

test("Visual Bible diagnostics expose profile source vocabulary", () => {
  const store = createMemoryVisualScopeStore();
  const context = makeContext("source-labels");
  const emptyBible = resolveChatVisualBible({
    context,
    store,
    settings: {
      characterAppearance: "米特: purple ponytail",
      sceneLibrary: "街道: stone street",
      sceneActive: "街道",
    },
    sourceText: "米特站在街道上。",
  });

  assert.equal(emptyBible.diagnostics.sourceLabels.characterAppearance, "missing");
  assert.equal(emptyBible.diagnostics.sourceLabels.sceneLibrary, "missing");
  assert.equal(emptyBible.diagnostics.legacyFallbackUsed, false);

  saveChatVisualScopePatch({
    context,
    store,
    patch: {
      characterAppearance: "米特: purple ponytail",
      sceneLibrary: "街道: stone street",
      sceneActive: "街道",
    },
  });

  const chatBible = resolveChatVisualBible({
    context,
    store,
    settings: {},
    sourceText: "米特站在街道上。",
  });

  assert.equal(chatBible.diagnostics.sourceLabels.characterAppearance, "character-card library");
  assert.equal(chatBible.diagnostics.sourceLabels.sceneLibrary, "character-card library");
});

test("comic bubble mode keeps dialogue metadata and forbids in-image text", () => {
  const visualBible = resolveChatVisualBible({
    context: makeContext("bubble-dialogue"),
    settings: {
      characterAppearance: "Mira: silver braid",
    },
    sourceText: "Mira speaks.",
  });

  const compiled = compileImagePrompt({
    mode: "comic",
    visualBible,
    dialogueEnabled: true,
    job: {
      characters: ["Mira"],
      promptParts: {
        visualMoment: "Mira leans into frame.",
        characters: ["Mira"],
        dialogue: ["Mira: Hold the line"],
        caption: "The rain gets louder.",
        dialogueMode: "bubble",
      },
    },
  });

  assert.match(compiled.prompt, /do not render readable text|no readable text|forbid readable text/i);
  assert.doesNotMatch(compiled.prompt, /draw readable dialogue/i);
  assert.deepEqual(compiled.diagnostics.dialogue, ["Mira: Hold the line"]);
  assert.equal(compiled.diagnostics.dialogueEnabled, true);
  assert.equal(compiled.diagnostics.dialogueMode, "bubble");
  assert.equal(compiled.diagnostics.imageTextPolicy, "plugin-bubble");
});

test("comic modelText mode writes dialogue into the prompt", () => {
  const compiled = compileImagePrompt({
    mode: "comic",
    dialogueEnabled: true,
    visualBible: resolveChatVisualBible({
      context: makeContext("model-text-dialogue"),
      settings: { characterAppearance: "Mira: silver braid" },
      sourceText: "Mira speaks.",
    }),
    job: {
      characters: ["Mira"],
      promptParts: {
        visualMoment: "Mira shouts across the tower hall.",
        characters: ["Mira"],
        dialogue: ["Mira: Hold the line"],
        caption: "The rain gets louder.",
        dialogueMode: "modelText",
      },
    },
  });

  assert.match(compiled.prompt, /draw readable dialogue|render readable dialogue|readable text/i);
  assert.match(compiled.prompt, /Mira: Hold the line/);
  assert.match(compiled.prompt, /The rain gets louder/);
  assert.deepEqual(compiled.diagnostics.dialogue, ["Mira: Hold the line"]);
  assert.equal(compiled.diagnostics.dialogueMode, "modelText");
  assert.equal(compiled.diagnostics.imageTextPolicy, "model-text");
});

test("built-in style catalog exposes three usable style presets", () => {
  assert.equal(BUILT_IN_STYLE_PRESETS.length, 3);
  const names = BUILT_IN_STYLE_PRESETS.map((preset) => preset.name);
  assert.deepEqual(new Set(names).size, 3);

  for (const preset of BUILT_IN_STYLE_PRESETS) {
    assert.match(preset.name, /\S/);
    assert.match(preset.text, /\S/);
    assert.ok(preset.text.length >= 80, `${preset.name} should carry enough visual detail`);
  }

  const libraryText = formatBuiltInStyleLibrary();
  for (const name of names) {
    assert.match(libraryText, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("built-in style import appends missing presets without overwriting user styles", () => {
  const firstPreset = BUILT_IN_STYLE_PRESETS[0];
  const existing = [
    `${firstPreset.name}: user tuned brush, keep this exact description`,
    "Custom Ink: sharp monochrome ink wash, dramatic silhouettes",
  ].join("\n");

  const merged = mergeBuiltInStylePresets(existing);

  assert.match(merged.text, /Custom Ink: sharp monochrome ink wash/);
  assert.match(merged.text, new RegExp(`${firstPreset.name}: user tuned brush`));
  assert.doesNotMatch(merged.text, new RegExp(`${firstPreset.name}: ${firstPreset.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(merged.skipped.length, 1);
  assert.equal(merged.added.length, BUILT_IN_STYLE_PRESETS.length - 1);
});

test("automatic visual extraction settings default off and normalize saved values", () => {
  assert.deepEqual(normalizeVisualExtractionSettings({}), {
    autoExtractCharactersEnabled: false,
    autoExtractScenesEnabled: false,
  });

  assert.deepEqual(normalizeVisualExtractionSettings({
    autoExtractCharactersEnabled: true,
    autoExtractScenesEnabled: 1,
  }), {
    autoExtractCharactersEnabled: true,
    autoExtractScenesEnabled: true,
  });
});

test("automatic visual extraction writes only to the active character-card scope", () => {
  const store = createMemoryVisualScopeStore();
  const cardA = makeContext("auto-a", "auto-a.jsonl", {
    characterName: "AutoA",
    characterAvatar: "auto-a.png",
  });
  const cardB = makeContext("auto-b", "auto-b.jsonl", {
    characterName: "AutoB",
    characterAvatar: "auto-b.png",
  });

  const result = applyAutomaticVisualExtraction({
    context: cardA,
    store,
    settings: {
      autoExtractCharactersEnabled: true,
      autoExtractScenesEnabled: true,
    },
    sourceText: [
      "Character Mira: silver braid, blue travel coat, brass lantern, calm green eyes.",
      "Scene Clocktower: rainy tower hall, brass gears, tall windows, cold moonlight.",
    ].join("\n"),
  });

  assert.equal(result.character.added.length, 1);
  assert.equal(result.scene.added.length, 1);

  const scopeA = loadChatVisualScope({ context: cardA, settings: {}, store });
  const scopeB = loadChatVisualScope({ context: cardB, settings: {}, store });
  assert.match(scopeA.values.characterAppearance, /Mira: silver braid/);
  assert.match(scopeA.values.sceneLibrary, /Clocktower: rainy tower hall/);
  assert.equal(scopeB.values.characterAppearance, "");
  assert.equal(scopeB.values.sceneLibrary, "");
});

test("automatic visual extraction dedupes by name and preserves manual edits", () => {
  const store = createMemoryVisualScopeStore();
  const context = makeContext("auto-dedupe", "auto-dedupe.jsonl", {
    characterName: "AutoDedupe",
    characterAvatar: "auto-dedupe.png",
  });
  saveChatVisualScopePatch({
    context,
    store,
    patch: {
      characterAppearance: "Mira: manually edited silver braid, blue coat, lantern charm",
      sceneLibrary: "Clocktower: manually edited rainy hall with brass gears",
    },
  });

  const result = applyAutomaticVisualExtraction({
    context,
    store,
    settings: {
      autoExtractCharactersEnabled: true,
      autoExtractScenesEnabled: true,
    },
    sourceText: [
      "Character Mira: auto extracted text that must not replace manual description.",
      "Character Sol: black hair, red scarf, compact crossbow, alert grey eyes.",
      "Scene Clocktower: auto extracted hall that must not replace manual scene.",
      "Scene Market: dawn street market, wet stone road, canvas awnings.",
      "<div>workflow status system prompt</div>",
    ].join("\n"),
  });

  const scope = loadChatVisualScope({ context, settings: {}, store });
  assert.match(scope.values.characterAppearance, /Mira: manually edited silver braid/);
  assert.doesNotMatch(scope.values.characterAppearance, /Mira: auto extracted text/);
  assert.match(scope.values.characterAppearance, /Sol: black hair/);
  assert.match(scope.values.sceneLibrary, /Clocktower: manually edited rainy hall/);
  assert.doesNotMatch(scope.values.sceneLibrary, /Clocktower: auto extracted hall/);
  assert.match(scope.values.sceneLibrary, /Market: dawn street market/);
  assert.equal(result.character.skipped.length, 1);
  assert.equal(result.scene.skipped.length, 1);
});
