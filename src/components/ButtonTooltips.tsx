import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Delegated help covers toolbar, dynamic tree and third-party buttons, including keyboard focus. */
export function ButtonTooltips({ delay, enabled = true }: { delay: number; enabled?: boolean }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let owner: Element | null = null;
    let priorDescription: string | null = null;
    const hide = () => {
      clearTimeout(timer);
      if (owner) {
        if (priorDescription === null) owner.removeAttribute('aria-describedby');
        else owner.setAttribute('aria-describedby', priorDescription);
      }
      owner = null;
      setTip(null);
    };
    const show = (event: Event) => {
      const target =
        event
          .composedPath()
          .find(
            (item): item is Element =>
              item instanceof Element && item.matches('button, summary, [role="button"]'),
          ) ??
        (event.target instanceof Element
          ? event.target.closest('button, summary, [role="button"]')
          : null);
      if (target === owner) return;
      hide();
      if (!target) return;
      owner = target;
      priorDescription = target.getAttribute('aria-describedby');
      const text =
        target.getAttribute('data-tooltip') ||
        target.getAttribute('aria-label') ||
        target.getAttribute('title') ||
        target.querySelector('title')?.textContent ||
        target.textContent?.trim();
      if (!text) return;
      timer = setTimeout(() => {
        if (!target.isConnected) return;
        target.setAttribute(
          'aria-describedby',
          [priorDescription, 'studio-control-tooltip'].filter(Boolean).join(' '),
        );
        const bounds = target.getBoundingClientRect();
        setTip({
          text,
          x: Math.max(8, Math.min(bounds.left, innerWidth - 280)),
          y:
            bounds.bottom + 8 > innerHeight - 60 ? Math.max(8, bounds.top - 44) : bounds.bottom + 8,
        });
      }, delay);
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', hide);
    document.addEventListener('focusout', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', hide);
      document.removeEventListener('focusout', hide);
    };
  }, [delay, enabled]);
  useEffect(() => {
    if (tip) ref.current?.showPopover?.();
  }, [tip]);
  return tip && enabled
    ? createPortal(
        <div
          ref={ref}
          popover="manual"
          id="studio-control-tooltip"
          role="tooltip"
          className="studio-button-tooltip"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>,
        document.body,
      )
    : null;
}
