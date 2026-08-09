import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEXT_POLISH_PROMPT,
  createPromptPolishConfig,
  migrateSettingsState,
  normalizePromptPolishConfig,
} from './settingsStore';

describe('prompt polishing settings', () => {
  it('creates an independent empty selection for a new profile', () => {
    expect(createPromptPolishConfig('template')).toEqual({
      textApiId: null,
      textModelId: null,
      reasoningEffort: null,
      prompt: 'template',
    });
  });

  it('keeps an explicit API and model reference without relying on API enabled state', () => {
    expect(normalizePromptPolishConfig({
      textApiId: 'provider-b',
      textModelId: 'model-b',
      reasoningEffort: 'high',
      prompt: 'Keep the meaning.',
    }, DEFAULT_TEXT_POLISH_PROMPT)).toEqual({
      textApiId: 'provider-b',
      textModelId: 'model-b',
      reasoningEffort: 'high',
      prompt: 'Keep the meaning.',
    });
  });

  it('uses safe defaults for malformed persisted values', () => {
    expect(normalizePromptPolishConfig({
      textApiId: '  ',
      textModelId: 42,
      reasoningEffort: 'unsupported',
    }, 'fallback template')).toEqual({
      textApiId: null,
      textModelId: null,
      reasoningEffort: null,
      prompt: 'fallback template',
    });
  });

  it('migrates the legacy shared selection into image and text profiles', () => {
    const migrated = migrateSettingsState({
      textApis: [{
        id: 'legacy-provider',
        name: 'Legacy Provider',
        apiKey: 'key',
        baseUrl: 'https://legacy.example/v1',
        modelId: 'legacy-model',
        selectedModelIds: ['legacy-model'],
        enabled: true,
      }],
      textPolishReasoningEffort: 'high',
      imagePolishPrompt: 'legacy image template',
    }, 24) as {
      imagePolishConfig: unknown;
      textPolishConfig: unknown;
    };

    expect(migrated.imagePolishConfig).toEqual({
      textApiId: 'legacy-provider',
      textModelId: 'legacy-model',
      reasoningEffort: 'high',
      prompt: 'legacy image template',
    });
    expect(migrated.textPolishConfig).toMatchObject({
      textApiId: 'legacy-provider',
      textModelId: 'legacy-model',
      reasoningEffort: 'high',
      prompt: DEFAULT_TEXT_POLISH_PROMPT,
    });
  });
});
