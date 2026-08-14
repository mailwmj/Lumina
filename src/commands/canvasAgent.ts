import { invoke, isTauri } from '@tauri-apps/api/core';

export interface CanvasAgentRuntimeInfo {
  available: boolean;
  running: boolean;
  url: string | null;
  token: string | null;
  registrationCommand: string | null;
  error: string | null;
}

export function isCanvasAgentManagedByLumina(): boolean {
  return isTauri();
}

export async function getCanvasAgentRuntime(): Promise<CanvasAgentRuntimeInfo | null> {
  if (!isTauri()) {
    return null;
  }
  return await invoke<CanvasAgentRuntimeInfo>('get_canvas_agent_runtime');
}
