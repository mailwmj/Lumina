export interface CloseRequestedEvent {
  preventDefault: () => void;
}

interface WindowCloseActions {
  flush: () => Promise<boolean>;
  destroy: () => Promise<void>;
  beforeClose?: () => boolean;
  onFlushFailure: () => void;
}

export function createWindowCloseHandler({
  flush,
  destroy,
  beforeClose = () => true,
  onFlushFailure,
}: WindowCloseActions): (event: CloseRequestedEvent) => void {
  let closing = false;

  return (event) => {
    // Tauri destroys the window after any listener that does not prevent it.
    event.preventDefault();
    if (closing) {
      return;
    }
    if (!beforeClose()) return;
    closing = true;
    void (async () => {
      try {
        if (!await flush()) onFlushFailure();
      } catch {
        onFlushFailure();
      } finally {
        await destroy();
      }
    })();
  };
}

export async function requestWindowClose(window: { close: () => Promise<void> }): Promise<void> {
  await window.close();
}
