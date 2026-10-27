import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export interface ModalProps {
  title: string;
  children: ReactNode;
  onClose(): void;
  footer?: ReactNode;
  wide?: boolean;
}
/** Native dialog anchors to the visible viewport and supplies keyboard focus containment. */
export function Modal({ title, children, onClose, footer, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={'studio-modal ' + (wide ? 'wide' : '')}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const bounds = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
          <i aria-hidden="true" className="bi bi-x-lg" />
        </button>
      </header>
      <section>{children}</section>
      {footer ? <footer>{footer}</footer> : null}
    </dialog>
  );
}
