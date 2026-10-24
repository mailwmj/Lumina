import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactFlowProvider } from '@xyflow/react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AgentWorkspace } from './features/agent/ui/AgentWorkspace';
import { TitleBar } from './components/TitleBar';
import { LogPanel } from '@/lib/logger/LogPanel';
import { useLogPanelHotkey } from '@/lib/logger/useLogPanelHotkey';
import { SettingsDialog } from './components/SettingsDialog';
import { UpdateAvailableDialog, type UpdateIgnoreMode } from './components/UpdateAvailableDialog';
import { GlobalErrorDialog } from './components/GlobalErrorDialog';
import { ProjectManager } from './features/project/ProjectManager';
import { BatchImageCropWorkbench } from './features/batch-image-crop/BatchImageCropWorkbench';
import { useThemeStore } from './stores/themeStore';
import { flushAllPendingPersists, useProjectStore } from './stores/projectStore';
import { useSettingsStore } from './stores/settingsStore';
import { logger } from '@/lib/logger';
import { flushCanvasPersist } from '@/features/canvas/application/canvasPersistFlush';
import { flushAgentThreadPersists } from '@/features/agent/application/agentThreadService';
import { createWindowCloseHandler } from '@/application/windowClose';
import {
  checkForUpdate,
  isUpdateVersionSuppressed,
  suppressUpdateVersion,
} from './features/update/application/checkForUpdate';
import {
  subscribeOpenGlobalErrorDialog,
  type GlobalErrorDialogDetail,
} from './features/app/errorDialogEvents';
import {
  subscribeOpenSettingsDialog,
  type OpenSettingsEventDetail,
} from './features/settings/settingsEvents';
import {
  getAccentForeground,
  hexToRgbChannels,
  normalizeAccentColor,
} from './features/settings/application/accentColor';

function App() {
  const { t } = useTranslation();
  useLogPanelHotkey();
  const { theme } = useThemeStore();
  const accentColor = useSettingsStore((state) => state.accentColor);
  const autoCheckAppUpdateOnLaunch = useSettingsStore((state) => state.autoCheckAppUpdateOnLaunch);
  const enableUpdateDialog = useSettingsStore((state) => state.enableUpdateDialog);
  const setEnableUpdateDialog = useSettingsStore((state) => state.setEnableUpdateDialog);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<OpenSettingsEventDetail>({});
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [globalError, setGlobalError] = useState<GlobalErrorDialogDetail | null>(null);
  const [activeHomeTool, setActiveHomeTool] = useState<'batch-crop' | null>(null);
  const homeToolBackHandlerRef = useRef<() => void>(() => undefined);
  const beforeWindowCloseRef = useRef<(() => boolean) | null>(null);

  const isHydrated = useProjectStore((state) => state.isHydrated);
  const hydrate = useProjectStore((state) => state.hydrate);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const closeProject = useProjectStore((state) => state.closeProject);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const isMac =
      typeof navigator !== 'undefined'
      && /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
    root.dataset.platform = isMac ? 'macos' : 'default';
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const normalized = normalizeAccentColor(accentColor);
    root.style.setProperty('--accent', normalized);
    root.style.setProperty('--accent-rgb', hexToRgbChannels(normalized));
    root.style.setProperty('--accent-foreground', getAccentForeground(normalized));
  }, [accentColor]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const unsubscribe = subscribeOpenGlobalErrorDialog((detail) => {
      setGlobalError(detail);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeOpenSettingsDialog((detail) => {
      setSettingsTarget(detail);
      setShowSettings(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();
    void appWindow.onCloseRequested(createWindowCloseHandler({
      flush: async () => {
        flushCanvasPersist();
        const results = await Promise.all([flushAllPendingPersists(), flushAgentThreadPersists()]);
        return results.every(Boolean);
      },
      destroy: () => appWindow.destroy(),
      beforeClose: () => beforeWindowCloseRef.current?.() ?? true,
      onFlushFailure: () => logger.error('Window is closing after project persistence failed'),
    })).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof window.setTimeout> | null = null;

    const notifyFrontendReady = async (attempt = 1) => {
      if (cancelled) {
        return;
      }

      try {
        await invoke('frontend_ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (attempt === 1 || attempt % 10 === 0) {
          logger.warn('failed to notify frontend readiness', error);
        }

        const retryDelayMs = Math.min(500, 80 * attempt);
        retryTimer = window.setTimeout(() => {
          void notifyFrontendReady(attempt + 1);
        }, retryDelayMs);
      }
    };

    requestAnimationFrame(() => {
      void notifyFrontendReady();
    });

    return () => {
      cancelled = true;
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let cancelled = false;
    const runUpdateCheck = async () => {
      if (!autoCheckAppUpdateOnLaunch) {
        return;
      }
      const result = await checkForUpdate();
      if (!cancelled && result.hasUpdate && result.latestVersion && enableUpdateDialog) {
        if (isUpdateVersionSuppressed(result.latestVersion)) {
          return;
        }
        setLatestVersion(result.latestVersion ?? '');
        setCurrentVersion(result.currentVersion ?? '');
        setShowUpdateDialog(true);
      }
    };

    void runUpdateCheck();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, autoCheckAppUpdateOnLaunch, enableUpdateDialog]);

  const handleApplyIgnore = (mode: UpdateIgnoreMode) => {
    if (mode === 'forever-all') {
      setEnableUpdateDialog(false);
      return;
    }

    if (!latestVersion) {
      return;
    }

    suppressUpdateVersion(latestVersion, mode === 'today-version' ? 'today' : 'forever');
  };

  if (!isHydrated) {
    return (
      <ReactFlowProvider>
        <div className="flex h-full w-full items-center justify-center bg-bg-dark">
          <p role="status" className="text-sm text-text-muted">{t('common.loading')}</p>
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="w-full h-full flex flex-col bg-bg-dark">
        <TitleBar
          onSettingsClick={() => {
            setSettingsTarget({});
            setShowSettings(true);
          }}
          showBackButton={Boolean(currentProjectId || activeHomeTool)}
          onBackClick={activeHomeTool ? () => homeToolBackHandlerRef.current() : closeProject}
          contextTitle={activeHomeTool ? t('batchCrop.entry') : undefined}
        />

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {currentProjectId ? (
            <AgentWorkspace projectId={currentProjectId} />
          ) : activeHomeTool === 'batch-crop' ? (
            <BatchImageCropWorkbench
              beforeWindowCloseRef={beforeWindowCloseRef}
              backHandlerRef={homeToolBackHandlerRef}
              onExit={() => setActiveHomeTool(null)}
            />
          ) : (
            <ProjectManager onOpenBatchCrop={() => setActiveHomeTool('batch-crop')} />
          )}
        </main>

        <SettingsDialog
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          initialCategory={settingsTarget.category}
          initialProviderKind={settingsTarget.providerKind}
        />
        <UpdateAvailableDialog
          isOpen={showUpdateDialog}
          onClose={() => setShowUpdateDialog(false)}
          latestVersion={latestVersion}
          currentVersion={currentVersion}
          onApplyIgnore={handleApplyIgnore}
        />
        <GlobalErrorDialog
          isOpen={Boolean(globalError)}
          title={globalError?.title ?? ''}
          message={globalError?.message ?? ''}
          details={globalError?.details}
          copyText={globalError?.copyText}
          onClose={() => setGlobalError(null)}
        />
        {import.meta.env.DEV && <LogPanel />}
      </div>
    </ReactFlowProvider>
  );
}

export default App;
