import { createAgentLanguageModel, type AgentModelSelection } from '@/features/agent/infrastructure/agentModelFactory';
import { probeAgentModel } from '@/features/agent/infrastructure/agentModelProbe';
import {
  agentModelCapabilityKey,
  useAgentSettingsStore,
  type AgentModelCapabilities,
} from '@/features/agent/stores/agentSettingsStore';
import { useSettingsStore } from '@/stores/settingsStore';

const inFlight = new Map<string, Promise<AgentModelCapabilities>>();

/** Probes a text model the first time it is picked; later calls read the cached verdict. */
export function ensureAgentModelCapabilities(selection: AgentModelSelection): Promise<AgentModelCapabilities> {
  const key = agentModelCapabilityKey(selection);
  const cached = useAgentSettingsStore.getState().modelCapabilities[key];
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const probe = (async () => {
    // Probe without reasoning so the check stays small and fast.
    const { model } = createAgentLanguageModel(useSettingsStore.getState().textApis, selection, null);
    const capabilities = { ...(await probeAgentModel(model)), probedAt: Date.now() };
    useAgentSettingsStore.getState().setModelCapabilities(selection, capabilities);
    return capabilities;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, probe);
  return probe;
}
