// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ImageReferencePromptInput } from './ImageReferencePromptInput';

const images = ['e1', 'e2', 'e3'].map((edgeId) => ({ edgeId, imageUrl: null, previewImageUrl: null }));
let container: HTMLDivElement; let root: Root; let latestValue = '';

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  latestValue = value;
  return (
    <ImageReferencePromptInput
      value={value} imageInputs={images} placeholder="" ariaLabel="prompt"
      onValueChange={(next) => setValue(next)}
    />
  );
}

const editor = () => container.querySelector<HTMLDivElement>('[role="textbox"]')!;
const options = () => document.body.querySelectorAll('[role="option"]');
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const key = (k: string) => act(async () => {
  editor().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
function placeCaretAtEnd() {
  const range = document.createRange();
  range.selectNodeContents(editor()); range.collapse(false);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('en');
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it('keeps a typed @ as text when the picker is dismissed', async () => {
  await act(async () => root.render(<Harness initial="see" />));
  editor().focus(); placeCaretAtEnd();
  await key('@'); await flush();
  expect(latestValue).toBe('see@');
  expect(options()).toHaveLength(3);

  await key('Escape'); await flush();
  expect(options()).toHaveLength(0);
  expect(latestValue).toBe('see@');
});

it('filters by the number typed after @ and replaces both with the reference on Enter', async () => {
  await act(async () => root.render(<Harness initial="" />));
  editor().focus(); placeCaretAtEnd();
  await key('@'); await flush();

  await act(async () => {
    editor().textContent = '@2'; placeCaretAtEnd();
    editor().dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '2', bubbles: true }));
  });
  await flush();
  expect(Array.from(options()).map((option) => option.textContent)).toEqual(['2']);

  await key('Enter'); await flush();
  expect(latestValue).toBe('{{image-ref:e2}}');
  expect(options()).toHaveLength(0);
});
