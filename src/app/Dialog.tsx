import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Keeps Tab and Shift+Tab within the dialog's buttons. */
function trapFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Modal dialog over the game: focuses its first button when it opens and keeps keyboard
 * focus inside. Escape is not handled here (the pause dialog's keys belong to the game).
 */
export function Dialog({
  titleId,
  descriptionId,
  children,
}: {
  titleId: string;
  descriptionId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);

  return (
    <div className="end-backdrop">
      <section
        ref={ref}
        className="end-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={trapFocus}
      >
        {children}
      </section>
    </div>
  );
}
