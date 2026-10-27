import { useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import type { ProjectTreeNode } from '../core/project/vfs';
import * as vfs from '../core/project/vfs';
import type { StudioController } from '../app/controller';
import type { StudioState } from '../core/state';
import { download, fileBytes } from '../adapters/files';
import { droppedFiles } from '../adapters/drop';
import { Modal } from './Modal';
export function Explorer({
  controller,
  state,
}: {
  controller: StudioController;
  state: StudioState;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [clipboard, setClipboard] = useState<{ path: string; copy: boolean } | null>(null);
  const [menu, setMenu] = useState<{ path: string; folder: boolean; x: number; y: number } | null>(
    null,
  );
  const [dialog, setDialog] = useState<{ type: 'file' | 'folder' | 'rename'; path: string } | null>(
      null,
    ),
    [draft, setDraft] = useState('');
  const selected = state.selectedFile;
  const setSelected = (key: string) =>
    controller.store.update((current) => ({ ...current, selectedFile: key }));
  const folder = (key: string): string =>
    Object.hasOwn(state.project.files, key) ? vfs.parent(key) : key;
  const openDialog = (type: 'file' | 'folder' | 'rename', key: string) => {
    setDraft(type === 'rename' ? vfs.name(key) : '');
    setDialog({ type, path: key });
    setMenu(null);
  };
  const deleteEntry = (key: string) => {
    if (
      confirm('Delete ' + key + ' and any children?') &&
      controller.mutateProject((project) => vfs.remove(project, key))
    )
      setSelected(vfs.parent(key));
    setMenu(null);
  };
  const paste = (destination: string) => {
    if (
      clipboard &&
      controller.moveEntry(clipboard.path, folder(destination), {
        intoFolder: true,
        copy: clipboard.copy,
      }) &&
      !clipboard.copy
    )
      setClipboard(null);
    setMenu(null);
  };
  function keyboard(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === 'v') paste(selected);
      else if (selected) setClipboard({ path: selected, copy: event.key.toLowerCase() === 'c' });
    } else if (event.key === 'F2' && selected) {
      event.preventDefault();
      openDialog('rename', selected);
    } else if (event.key === 'Delete' && selected) {
      event.preventDefault();
      deleteEntry(selected);
    }
  }
  function drop(event: DragEvent, destination: string) {
    event.preventDefault();
    event.stopPropagation();
    const source = event.dataTransfer.getData('application/x-gcscript-path');
    if (source)
      controller.moveEntry(source, destination, {
        intoFolder: true,
        copy: event.ctrlKey || event.altKey,
      });
    else {
      void droppedFiles(event.dataTransfer, controller.config.project.marker)
        .then((files) => controller.importFiles(files, destination))
        .catch((error: unknown) => controller.notify(String(error), true));
    }
  }
  function row(node: ProjectTreeNode, depth = 0) {
    const isFolder = node.type === 'directory',
      open = expanded[node.path] !== false,
      entry = node.path === state.options.entryFile;
    return (
      <div
        key={node.path}
        role="treeitem"
        aria-expanded={isFolder ? open : undefined}
        aria-selected={selected === node.path}
      >
        <button
          className={
            'item fs-row ' +
            (state.project.active === node.path || selected === node.path ? 'active' : '')
          }
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onFocus={() => setSelected(node.path)}
          data-studio-file={node.path}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-gcscript-path', node.path);
            e.dataTransfer.effectAllowed = 'copyMove';
          }}
          onDragOver={(e) => {
            if (isFolder) e.preventDefault();
          }}
          onDrop={(e) => drop(e, isFolder ? node.path : vfs.parent(node.path))}
          onClick={() => {
            setSelected(node.path);
            if (isFolder) setExpanded((previous) => ({ ...previous, [node.path]: !open }));
            else
              controller.store.update((previous) => ({
                ...previous,
                project: { ...previous.project, active: node.path },
                selection: [],
                report: null,
                diagnostics: null,
              }));
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelected(node.path);
            setMenu({
              path: node.path,
              folder: isFolder,
              x: Math.min(e.clientX, innerWidth - 230),
              y: Math.min(e.clientY, innerHeight - 390),
            });
          }}
        >
          <i
            aria-hidden="true"
            className={
              'bi ' +
              (isFolder
                ? open
                  ? 'bi-folder2-open'
                  : 'bi-folder2'
                : vfs.isGCScript(node.path)
                  ? 'bi-braces'
                  : node.file.encoding === 'base64'
                    ? 'bi-file-earmark-binary'
                    : 'bi-file-earmark')
            }
          />
          <span className="itemlabel">{node.name}</span>
          {entry ? (
            <i
              aria-hidden="true"
              className="bi bi-play-circle-fill"
              aria-label="Project entrypoint"
            />
          ) : null}
        </button>
        {isFolder && open ? (
          <div role="group">{node.children.map((child) => row(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  }
  const root = vfs.tree(state.project);
  return (
    <section
      className="explorer"
      onKeyDown={keyboard}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => drop(e, '')}
    >
      <div className="d-flex gap-1 mb-2">
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => openDialog('file', selected)}
          aria-label="New file"
        >
          <i aria-hidden="true" className="bi bi-file-earmark-plus" />
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => openDialog('folder', selected)}
          aria-label="New folder"
        >
          <i aria-hidden="true" className="bi bi-folder-plus" />
        </button>
        <button
          className="btn btn-sm btn-outline-secondary ms-auto"
          onClick={() => void controller.closeProject()}
          aria-label="Close project"
        >
          <i aria-hidden="true" className="bi bi-folder-x" />
        </button>
      </div>
      <div
        role="tree"
        aria-label="Project files"
        tabIndex={0}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            setMenu({ path: '', folder: true, x: e.clientX, y: e.clientY });
          }
        }}
      >
        {root.children.length ? (
          root.children.map((node) => row(node))
        ) : (
          <p className="field-hint p-3">Empty project. Create or import a file to begin.</p>
        )}
      </div>
      {menu ? (
        <>
          <button
            className="menu-dismiss"
            aria-label="Dismiss file menu"
            onClick={() => setMenu(null)}
          />
          <div
            className="fs-context"
            style={{ left: Math.max(4, menu.x), top: Math.max(4, menu.y) }}
            role="menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMenu(null);
            }}
          >
            <button role="menuitem" onClick={() => openDialog('file', menu.path)}>
              New file
            </button>
            <button role="menuitem" onClick={() => openDialog('folder', menu.path)}>
              New folder
            </button>
            {menu.path ? (
              <>
                <hr />
                <button role="menuitem" onClick={() => openDialog('rename', menu.path)}>
                  Rename
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setClipboard({ path: menu.path, copy: true });
                    setMenu(null);
                  }}
                >
                  Copy
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setClipboard({ path: menu.path, copy: false });
                    setMenu(null);
                  }}
                >
                  Cut
                </button>
              </>
            ) : null}
            <button role="menuitem" disabled={!clipboard} onClick={() => paste(menu.path)}>
              Paste
            </button>
            {!menu.folder ? (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    const file = state.project.files[menu.path];
                    if (file)
                      download(
                        vfs.name(menu.path),
                        fileBytes(file),
                        'application/octet-stream',
                        controller.config.timing.downloadRevoke,
                      );
                    setMenu(null);
                  }}
                >
                  Download file
                </button>
                {vfs.isGCScript(menu.path) ? (
                  <button
                    role="menuitem"
                    onClick={() => {
                      controller.store.update((previous) => ({
                        ...previous,
                        options: { ...previous.options, entryFile: menu.path },
                      }));
                      setMenu(null);
                    }}
                  >
                    Set as entrypoint
                  </button>
                ) : null}
              </>
            ) : null}
            {menu.path ? (
              <>
                <hr />
                <button role="menuitem" onClick={() => deleteEntry(menu.path)}>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {dialog ? (
        <Modal
          title={
            dialog.type === 'rename'
              ? 'Rename entry'
              : dialog.type === 'file'
                ? 'New file'
                : 'New folder'
          }
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const location =
                dialog.type === 'rename' ? vfs.parent(dialog.path) : folder(dialog.path);
              const target = (location ? location + '/' : '') + draft;
              const success =
                dialog.type === 'rename'
                  ? controller.moveEntry(dialog.path, target)
                  : controller.mutateProject((project) =>
                      dialog.type === 'folder'
                        ? vfs.mkdir(project, target)
                        : {
                            ...vfs.put(project, target, {
                              encoding: 'utf8',
                              text: vfs.isGCScript(target) ? controller.config.project.source : '',
                            }),
                            active: target,
                          },
                    );
              if (success) setDialog(null);
            }}
          >
            <label className="form-label" htmlFor="file-name">
              Path inside /
              {dialog.type === 'rename' ? vfs.parent(dialog.path) : folder(dialog.path)}
            </label>
            <input
              autoFocus
              id="file-name"
              className="form-control mb-3"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
            />
            <button className="btn btn-primary" type="submit">
              {dialog.type === 'rename' ? 'Rename' : 'Create'}
            </button>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
