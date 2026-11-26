import { useEffect, useState } from 'react';
import type { StudioController } from '../app/controller';
import type { StudioState } from '../core/state';
import { encodeEditLink } from '../adapters/edit-links';
import { errorMessage } from '../core/json';

/** Prepare the current project link so a normal anchor click opens it without popup blocking. */
export function OpenProjectTab({
  controller,
  state,
}: {
  controller: StudioController;
  state: StudioState;
}) {
  const { project, mode } = state;
  const [link, setLink] = useState<{ project: typeof project; mode: typeof mode; url: string }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void encodeEditLink(project, controller.baseURL, controller.config, {
        view: mode === 'nodes' ? 'node' : mode === 'blocks' ? 'block' : 'code',
      }).then(
        (url) => {
          if (!cancelled) {
            setLink({ project, mode, url });
            setError('');
          }
        },
        (reason) => {
          if (!cancelled) setError(errorMessage(reason));
        },
      );
    }, controller.config.timing.editorDebounce);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [controller, project, mode]);
  const url = link?.project === project && link.mode === mode ? link.url : undefined;
  return (
    <a
      className="icon-btn open-project-tab"
      aria-label="Open current project in a new tab"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      role="link"
      tabIndex={0}
      aria-disabled={!url}
      onKeyDown={(event) => {
        if (!url && event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      onClick={(event) => {
        if (!url) {
          event.preventDefault();
          controller.notify(
            error || 'Preparing the current project link. Try again in a moment.',
            Boolean(error),
          );
        }
      }}
    >
      <i aria-hidden="true" className="bi bi-box-arrow-up-right" />
    </a>
  );
}
