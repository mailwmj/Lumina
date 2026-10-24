// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { ImageModelDefinition } from '@/features/canvas/models';
import { AUTO_REQUEST_ASPECT_RATIO } from '@/features/canvas/domain/canvasNodes';
import { ModelParamsControls } from './ModelParamsControls';

function model(id: string, providerId: string, displayName: string): ImageModelDefinition {
  return {
    id, providerId, providerName: providerId, displayName, mediaType: 'image', description: '', eta: '',
    defaultAspectRatio: '1:1', defaultResolution: '1K', aspectRatios: [], resolutions: [],
    resolveRequest: () => ({ requestModel: id, modeLabel: '' }),
  };
}

const models = [model('a/one', 'prov-a', 'Model One'), model('b/two', 'prov-b', 'Model Two')];
const ratios = ['1:1', '9:16', AUTO_REQUEST_ASPECT_RATIO, '21:9', '4:3', '2:3'].map((value) => ({ value, label: value }));
const resolution = { value: '1K', label: '1K' };
let container: HTMLDivElement; let root: Root;
const onModelChange = vi.fn();

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('en');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(
    <ModelParamsControls
      imageModels={models} selectedModel={models[0]} resolutionOptions={[resolution]} selectedResolution={resolution}
      selectedAspectRatio={ratios[0]} aspectRatioOptions={ratios} onModelChange={onModelChange}
      onResolutionChange={() => undefined} onAspectRatioChange={() => undefined}
    />
  ));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); onModelChange.mockReset(); vi.unstubAllGlobals();
});

const triggers = () => container.querySelectorAll<HTMLButtonElement>('button');
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });

it('orders aspect ratios auto first, then widest to tallest', async () => {
  await act(async () => triggers()[1].click());
  const labels = Array.from(document.body.querySelectorAll('[role="radiogroup"]')[0].querySelectorAll('[role="radio"]'))
    .map((radio) => radio.textContent);
  expect(labels).toEqual([AUTO_REQUEST_ASPECT_RATIO, '21:9', '4:3', '1:1', '2:3', '9:16']);
});

it('browses providers without changing the model, and commits only on model pick', async () => {
  await act(async () => triggers()[0].click());
  const tab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) => el.textContent === 'prov-b')!;
  await act(async () => tab.click());
  expect(onModelChange).not.toHaveBeenCalled();
  const option = document.body.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(option.textContent).toBe('Model Two');
  await act(async () => option.click());
  expect(onModelChange).toHaveBeenCalledWith('b/two');
});

it('closes the open panel on Escape', async () => {
  await act(async () => triggers()[0].click());
  expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await flush();
  expect(document.body.querySelector('[role="listbox"]')).toBeNull();
});
