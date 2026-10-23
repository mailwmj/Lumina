// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import {
  createDefaultChaomoImageApiConfig,
  createDefaultOpenAiImageApiConfig,
} from '@/stores/settingsStore';

import { ImageApisSettings, type ImageApisSettingsValue } from './ImageApisSettings';

vi.mock('@/commands/ai', () => ({ discoverImageModels: vi.fn() }));

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ImageApisSettings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the selected models when the API key changes and asks the user to refetch instead', async () => {
    let value: ImageApisSettingsValue = {
      openAiImageApi: {
        ...createDefaultOpenAiImageApiConfig(),
        apiKey: 'sk-old',
        modelCatalog: { models: [{ id: 'ai-media/gpt-image-2' }], refreshedAt: 1 },
        selectedModelIds: ['ai-media/gpt-image-2'],
      },
      chaomoImageApi: createDefaultChaomoImageApiConfig(),
      customImageApis: [],
    };
    const render = () => root.render(
      <ImageApisSettings
        value={value}
        onChange={(patch) => { value = { ...value, ...patch }; render(); }}
      />
    );
    await act(async () => render());

    const providerButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('AI Media'));
    await act(async () => providerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const keyInput = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await act(async () => typeInto(keyInput, 'sk-new'));
    await act(async () => keyInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

    expect(value.openAiImageApi.apiKey).toBe('sk-new');
    expect(value.openAiImageApi.selectedModelIds).toEqual(['ai-media/gpt-image-2']);
    expect(value.openAiImageApi.modelCatalog?.models).toHaveLength(1);
    expect(container.textContent).toContain('连接信息已变更');
  });
});
