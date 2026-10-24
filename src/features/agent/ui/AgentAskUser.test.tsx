// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasAgentUIMessage } from '@/features/agent/application/canvasAgent';
import { askUserInputSchema, type AskUserInput } from '@/features/agent/domain/agentTools';
import i18n from '@/i18n';
import { AgentMessageParts } from './AgentMessageParts';

const question = (id: string, options = ['a', 'b']) => ({
  id,
  title: `问题 ${id}`,
  options: options.map((value) => ({ value, label: `选项 ${value}` })),
});

function askMessage(input: AskUserInput): CanvasAgentUIMessage {
  return {
    id: 'a-1',
    role: 'assistant',
    parts: [{ type: 'tool-ask_user', toolCallId: 'q-1', state: 'input-available', input }],
  } as CanvasAgentUIMessage;
}

describe('ask_user card', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onAnswer = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await i18n.changeLanguage('zh');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    onAnswer.mockReset();
    vi.unstubAllGlobals();
  });

  const render = (input: AskUserInput, { interactive = true, streaming = false } = {}) => act(async () => root.render(
    <AgentMessageParts
      message={askMessage(input)}
      streaming={streaming}
      interactive={interactive}
      onAnswer={onAnswer}
      onLocate={() => {}}
      onContinue={() => {}}
    />,
  ));
  const buttonByText = (text: string) => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);
  const click = (element: Element | undefined) => act(async () => { (element as HTMLElement).click(); });
  // Lets the question swap animation finish so only the current question is in the DOM.
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
  const radio = (label: string) => Array.from(container.querySelectorAll('[role="radio"]'))
    .find((item) => item.closest('label')?.textContent === label);
  const type = (text: string) => act(async () => {
    const field = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  it('accepts up to five questions', () => {
    const questions = (count: number) => ({ questions: Array.from({ length: count }, (_, index) => question(`q${index}`)) });
    expect(askUserInputSchema.safeParse(questions(5)).success).toBe(true);
    expect(askUserInputSchema.safeParse(questions(6)).success).toBe(false);
  });

  it('waits for the user to move on and keeps a picked option together with custom text', async () => {
    await render({ questions: [question('color'), question('ratio', ['v', 'h'])] });
    expect(container.textContent).toContain('1/2');
    expect(container.textContent).toContain('等你回答');

    await click(radio('选项 b'));
    await settle();
    expect(container.textContent).toContain('问题 color');

    // The model never asked for free text; the entry is there anyway.
    await click(buttonByText('自定义…'));
    await type('但不要荧光绿');
    expect(radio('选项 b')?.getAttribute('aria-checked')).toBe('true');

    await click(container.querySelector('[aria-label="下一个问题"]')!);
    await settle();
    expect(container.textContent).toContain('2/2');
    await click(container.querySelector('[aria-label="上一个问题"]')!);
    await settle();
    expect(container.querySelector('textarea')?.value).toBe('但不要荧光绿');

    await click(container.querySelector('[aria-label="下一个问题"]')!);
    await settle();
    await click(radio('选项 h'));
    await click(buttonByText('继续'));
    expect(onAnswer).toHaveBeenCalledWith('q-1', {
      color: { selected: ['b'], custom: '但不要荧光绿' },
      ratio: { selected: ['h'] },
    });
  });

  it('answers an open question with text alone', async () => {
    await render({ questions: [{ id: 'name', title: '店名是什么？' }] });
    expect(buttonByText('继续')?.disabled).toBe(true);
    await type('慢岛');
    await click(buttonByText('继续'));
    expect(onAnswer).toHaveBeenCalledWith('q-1', { name: { selected: [], custom: '慢岛' } });
  });

  it('shows a question the conversation moved past as read-only and unanswered', async () => {
    await render({ questions: [question('color')] }, { interactive: false });
    expect(container.textContent).toContain('未回答');
    expect(container.textContent).not.toContain('等你回答');
    const controls = container.querySelectorAll('[role="radio"]:not([disabled]), textarea:not([disabled])');
    expect(controls).toHaveLength(0);
  });
});
