// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { ExternalAgentSettings } from './ExternalAgentSettings';

const canvasAgentCommands = vi.hoisted(() => ({
  managed: true,
  getRuntime: vi.fn(),
}));

vi.mock('@/commands/canvasAgent', () => ({
  isCanvasAgentManagedByLumina: () => canvasAgentCommands.managed,
  getCanvasAgentRuntime: canvasAgentCommands.getRuntime,
}));

describe('ExternalAgentSettings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage('zh');
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    canvasAgentCommands.managed = true;
    canvasAgentCommands.getRuntime.mockResolvedValue({
      available: true,
      running: true,
      url: 'http://127.0.0.1:17372',
      token: 'private-token',
      registrationCommand: "codex mcp add lumina -- '/Applications/Lumina.app/Contents/MacOS/lumina-canvas-agent' mcp --config '/config/canvas-agent.json'",
      error: null,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows Lumina-managed status and registration without exposing manual secrets', async () => {
    await act(async () => {
      root.render(
        <ExternalAgentSettings
          value={{ enabled: true, url: 'http://127.0.0.1:17372', token: '' }}
          onChange={() => undefined}
        />
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain('运行中'));

    expect(container.textContent).toContain('codex mcp add lumina');
    expect(container.textContent).not.toContain('private-token');
    expect(container.querySelector('#external-agent-url')).toBeNull();
    expect(container.querySelector('#external-agent-token')).toBeNull();
  });

  it('keeps URL and token fields in browser development mode', async () => {
    canvasAgentCommands.managed = false;
    await act(async () => {
      root.render(
        <ExternalAgentSettings
          value={{ enabled: true, url: 'http://127.0.0.1:17372', token: 'dev-token' }}
          onChange={() => undefined}
        />
      );
    });

    expect(container.querySelector('#external-agent-url')).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector('#external-agent-token')).toBeInstanceOf(HTMLInputElement);
    expect(canvasAgentCommands.getRuntime).not.toHaveBeenCalled();
  });
});
