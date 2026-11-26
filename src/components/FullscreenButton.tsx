import { useEffect, useState } from 'react';
import type { StudioController } from '../app/controller';
import { errorMessage } from '../core/json';

/** Fullscreen stays local to this document, including when the IDE is inside an iframe. */
export function FullscreenButton({ controller }: { controller: StudioController }) {
  const [active, setActive] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const change = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await document.documentElement.requestFullscreen();
      else throw Error('Allow fullscreen on the embedding iframe, or open the IDE in a new tab.');
    } catch (error) {
      controller.notify('Fullscreen: ' + errorMessage(error), true);
    }
  }
  return (
    <button
      className="icon-btn fullscreen-button"
      aria-label={active ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-pressed={active}
      onClick={() => void toggle()}
    >
      <i aria-hidden="true" className={'bi ' + (active ? 'bi-fullscreen-exit' : 'bi-fullscreen')} />
    </button>
  );
}
