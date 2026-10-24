export interface CloseRequestedEvent {
  preventDefault: () => void;
}

interface WindowCloseActions {
  flush: () => Promise<boolean>;
  destroy: () => Promise<void>;
  deferToOtherHandler?: () => boolean;
  onFlushFailure: () => void;
}

export function createWindowCloseHandler({
  flush,
  destroy,
  deferToOtherHandler = () => false,
  onFlushFailure,
}: WindowCloseActions): (event: CloseRequestedEvent) => void {
  let closing = false;
  let allowClose = false;

  return (event) => {
    if (allowClose || deferToOtherHandler()) {
      return;
    }
    if (closing) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    closing = true;
    void (async () => {
      try {
        if (!await flush()) onFlushFailure();
      } catch {
        onFlushFailure();
      } finally {
        allowClose = true;
        closing = false;
        await destroy();
      }
    })();
  };
}

export async function requestWindowClose(window: { close: () => Promise<void> }): Promise<void> {
  await window.close();
}
