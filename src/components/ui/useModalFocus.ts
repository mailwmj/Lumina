import { useLayoutEffect, useRef } from 'react';

const modalStack: HTMLElement[] = [];
const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';

/** Keeps keyboard navigation in the topmost open modal and restores its trigger. */
export function useModalFocus(isOpen: boolean, isRendered: boolean, onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const modal = modalRef.current;
    if (!isOpen || !isRendered || !modal) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(modal);
    const getFocusable = () => Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0 && !element.closest('[aria-hidden="true"], [inert], [hidden]')
        && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
    if (!modal.contains(document.activeElement)) {
      (modal.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)')
        ?? getFocusable()[0] ?? modal).focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modal || event.isComposing || event.keyCode === 229) return;
      // Let a portalled select close its own menu before closing its parent modal.
      if (event.key === 'Escape' && !modal.querySelector('[aria-expanded="true"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = getFocusable();
      const first = elements[0] ?? modal;
      const last = elements[elements.length - 1] ?? modal;
      if (!modal.contains(document.activeElement) || document.activeElement === modal) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const wasTopmost = modalStack[modalStack.length - 1] === modal;
      modalStack.splice(modalStack.indexOf(modal), 1);
      if (wasTopmost && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, isRendered]);

  return modalRef;
}
