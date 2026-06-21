import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from './store';
import type { Level, LogEntry } from './types';

const ALL_LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_COLOR: Record<Level, string> = {
  debug: 'text-gray-400',
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

export function LogPanel(): JSX.Element | null {
  const { t } = useTranslation();
  const open = useLogStore((s) => s.open);
  const minimized = useLogStore((s) => s.minimized);
  const levelFilter = useLogStore((s) => s.levelFilter);
  const namespaceFilter = useLogStore((s) => s.namespaceFilter);
  const textQuery = useLogStore((s) => s.textQuery);
  const buffer = useLogStore((s) => s.buffer);
  const toggleLevelFilter = useLogStore((s) => s.toggleLevelFilter);
  const setNamespaceFilter = useLogStore((s) => s.setNamespaceFilter);
  const setTextQuery = useLogStore((s) => s.setTextQuery);
  const setMinimized = useLogStore((s) => s.setMinimized);
  const setOpen = useLogStore((s) => s.setOpen);
  const clearBuffer = useLogStore((s) => s.clearBuffer);

  // Subscribe to ring buffer changes to force re-render (zustand doesn't deep watch by default)
  const [, force] = useState(0);
  useEffect(() => useLogStore.getState().subscribe(() => force((n) => n + 1)), []);

  if (!open) return null;

  const allEntries = buffer.entries();
  const namespaces = Array.from(new Set(allEntries.map((e) => e.target))).sort();

  const visible = allEntries.filter((e) => {
    if (!levelFilter.has(e.level)) return false;
    if (namespaceFilter && e.target !== namespaceFilter) return false;
    if (textQuery) {
      const q = textQuery.toLowerCase();
      if (!e.message.toLowerCase().includes(q) &&
          !JSON.stringify(e.fields).toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  }).slice().reverse();

  return (
    <div
      data-testid="log-panel"
      className="fixed bottom-4 right-4 z-[9999] w-[480px] bg-zinc-900 text-zinc-100 rounded-lg shadow-2xl flex flex-col"
      style={{ height: minimized ? 40 : 320 }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700">
        <span className="text-sm font-semibold flex-1">{t('logger.panel.title')}</span>
        <button
          onClick={() => setMinimized(!minimized)}
          className="text-xs px-2 py-1 hover:bg-zinc-800 rounded"
          aria-label={t('logger.panel.minimize')}
        >
          {minimized ? '▢' : '—'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs px-2 py-1 hover:bg-zinc-800 rounded"
          aria-label={t('logger.panel.close')}
        >
          ×
        </button>
      </div>

      {!minimized && (
        <>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-700 text-xs">
            {ALL_LEVELS.map((lv) => (
              <button
                key={lv}
                onClick={() => toggleLevelFilter(lv)}
                className={`px-2 py-0.5 rounded ${
                  levelFilter.has(lv) ? LEVEL_COLOR[lv] + ' bg-zinc-800' : 'text-zinc-600 bg-zinc-900'
                }`}
              >
                {lv}
              </button>
            ))}
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder={t('logger.panel.search')}
              className="ml-auto px-2 py-0.5 bg-zinc-800 rounded text-xs w-32"
            />
            <button
              onClick={clearBuffer}
              className="px-2 py-0.5 hover:bg-zinc-800 rounded text-xs"
            >
              {t('logger.panel.clear')}
            </button>
          </div>

          <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-zinc-700 text-[10px] max-h-12 overflow-y-auto">
            <button
              onClick={() => setNamespaceFilter(null)}
              className={`px-1.5 py-0.5 rounded ${namespaceFilter === null ? 'bg-zinc-700' : 'hover:bg-zinc-800'}`}
            >
              all
            </button>
            {namespaces.map((ns) => (
              <button
                key={ns}
                onClick={() => setNamespaceFilter(ns)}
                className={`px-1.5 py-0.5 rounded ${
                  namespaceFilter === ns ? 'bg-zinc-700' : 'hover:bg-zinc-800'
                }`}
              >
                {ns}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-tight">
            {visible.length === 0 ? (
              <div className="text-zinc-500 text-center py-8">
                {allEntries.length === 0 ? t('logger.panel.empty') : t('logger.panel.noResults')}
              </div>
            ) : (
              visible.map((entry) => <LogLine key={entry.id} entry={entry} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="px-2 py-1 border-b border-zinc-800 hover:bg-zinc-800">
      <span className={`font-bold ${LEVEL_COLOR[entry.level]}`}>
        {entry.level.toUpperCase().padEnd(5)}
      </span>
      <span className="text-zinc-500 ml-2">{entry.target}</span>
      <span className="ml-2">{entry.message}</span>
      {Object.keys(entry.fields).length > 0 && (
        <details className="ml-2 mt-1">
          <summary className="text-zinc-500 cursor-pointer">fields</summary>
          <pre className="text-zinc-400 ml-4 whitespace-pre-wrap break-all">
            {JSON.stringify(entry.fields, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}