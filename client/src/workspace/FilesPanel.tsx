import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { TreeNode } from '../types';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { useRoom } from './RoomProvider';
import { badgeFor } from './language';
import { childrenOf, isInside } from './tree';
import { ZipError, readZip } from './zip';

type Draft = { parentId: string | null; type: 'FILE' | 'FOLDER' };

type MenuState = { x: number; y: number; nodeId: string | null };

export function FilesPanel({ roomName }: { roomName: string }) {
  const room = useRoom();
  const toast = useToast();

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; folder: boolean } | null>(null);
  const [recycleBin, setRecycleBin] = useState<Array<TreeNode & { deletedAt: string }>>([]);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [loadingRecycleBin, setLoadingRecycleBin] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (): void => setMenu(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [menu]);

  const toggle = (id: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmAndRemove = (id: string, name: string, isFolder: boolean) => {
    setPendingDelete({ id, name, folder: isFolder });
  };

  const openRecycleBin = async (): Promise<void> => {
    setShowRecycleBin(true);
    setLoadingRecycleBin(true);
    try {
      // Hocuspocus saves collaborative tree updates on a debounce. Retry for
      // a short window so a just-deleted item is present on the first open.
      let files: Array<TreeNode & { deletedAt: string }> = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 750));
        const result = await api<{ files: Array<TreeNode & { deletedAt: string }> }>(`/api/rooms/${room.roomId}/recycle-bin`);
        files = result.files;
        if (files.length > 0) break;
      }
      setRecycleBin(files);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load the recycle bin.', 'error');
    } finally {
      setLoadingRecycleBin(false);
    }
  };

  /** New items land in the selected folder, or the selected file's folder, like VS Code. */
  const creationParent = useCallback((): string | null => {
    if (!selectedId) return null;
    const node = room.tree.find((entry) => entry.id === selectedId);
    if (!node) return null;
    return node.type === 'FOLDER' ? node.id : node.parentId;
  }, [room.tree, selectedId]);

  const startDraft = (type: 'FILE' | 'FOLDER'): void => {
    if (room.readOnly) {
      toast('Viewers cannot change files.', 'error');
      return;
    }

    const parentId = creationParent();
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    setDraft({ parentId, type });
  };

  const commitDraft = (name: string): void => {
    const trimmed = name.trim();
    const current = draft;
    setDraft(null);
    if (!current || !trimmed) return;

    if (current.type === 'FILE') room.addFile(current.parentId, trimmed);
    else {
      const id = room.addFolder(current.parentId, trimmed);
      if (id) setExpanded((expandedNow) => new Set(expandedNow).add(id));
    }
  };

  const onDrop = (targetId: string | null): void => {
    const sourceId = dragId;
    setDragId(null);
    setDropTarget(undefined);

    if (!sourceId || sourceId === targetId) return;

    if (isInside(room.tree, sourceId, targetId)) {
      toast('A folder cannot be moved inside itself.', 'error');
      return;
    }

    room.move(sourceId, targetId);
    if (targetId) setExpanded((current) => new Set(current).add(targetId));
  };

  const onImport = async (file: File): Promise<void> => {
    setImporting(true);
    try {
      const entries = await readZip(file);
      const created = await room.importFiles(entries);
      toast(`Imported ${created} file${created === 1 ? '' : 's'}.`);
    } catch (error) {
      const message =
        error instanceof ZipError
          ? error.message
          : 'That archive could not be read. Try exporting it again.';
      toast(message, 'error');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const renderRow = (node: TreeNode, depth: number): React.ReactNode => {
    const isFolder = node.type === 'FOLDER';
    const isOpen = expanded.has(node.id);
    const badge = badgeFor(node.name);
    const children = isFolder ? childrenOf(room.tree, node.id) : [];
    const peopleHere = room.people.filter((person) => person.fileId === node.id && !person.isYou);

    return (
      <div key={node.id}>
        {renamingId === node.id ? (
          <InlineInput
            depth={depth}
            initial={node.name}
            icon={isFolder ? 'folder' : undefined}
            badge={isFolder ? undefined : badge}
            onCommit={(name) => {
              setRenamingId(null);
              if (name.trim() && name.trim() !== node.name) room.rename(node.id, name);
            }}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <div
            className={[
              'tree-row',
              room.activeFileId === node.id ? 'is-active' : '',
              selectedId === node.id ? 'is-selected' : '',
              dropTarget === node.id ? 'is-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 10 + depth * 15 }}
            role="treeitem"
            aria-expanded={isFolder ? isOpen : undefined}
            aria-selected={room.activeFileId === node.id}
            tabIndex={0}
            draggable={!room.readOnly}
            onDragStart={() => setDragId(node.id)}
            onDragEnd={() => {
              setDragId(null);
              setDropTarget(undefined);
            }}
            onDragOver={(event) => {
              if (!dragId) return;
              event.preventDefault();
              setDropTarget(isFolder ? node.id : node.parentId);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDrop(isFolder ? node.id : node.parentId);
            }}
            onClick={() => {
              setSelectedId(node.id);
              if (isFolder) toggle(node.id);
              else room.openFile(node.id);
            }}
            onDoubleClick={() => {
              if (!room.readOnly) setRenamingId(node.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSelectedId(node.id);
                if (isFolder) toggle(node.id);
                else room.openFile(node.id);
              } else if (event.key === 'F2' && !room.readOnly) {
                setRenamingId(node.id);
              } else if (event.key === 'Delete' && !room.readOnly) {
                confirmAndRemove(node.id, node.name, isFolder);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedId(node.id);
              setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
            }}
          >
            <span className="tree-twisty">
              {isFolder && <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} />}
            </span>

            {isFolder ? (
              <Icon name="folder" size={16} className="tree-folder-icon" />
            ) : (
              <span className={`file-badge tint-${badge.tint}`}>{badge.badge}</span>
            )}

            <span className="tree-name">{node.name}</span>

            {peopleHere.length > 0 && (
              <span className="tree-presence" title={peopleHere.map((p) => p.name).join(', ')}>
                {peopleHere.slice(0, 3).map((person) => (
                  <i key={person.clientId} style={{ background: person.color }} />
                ))}
              </span>
            )}

            {!room.readOnly && (
              <span className="tree-actions">
                {isFolder && (
                  <button
                    type="button"
                    className="tree-action-btn"
                    title="New file in folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded((prev) => new Set(prev).add(node.id));
                      setDraft({ parentId: node.id, type: 'FILE' });
                    }}
                  >
                    <Icon name="filePlus" size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className="tree-action-btn"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(node.id);
                  }}
                >
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  type="button"
                  className="tree-action-btn is-danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmAndRemove(node.id, node.name, isFolder);
                  }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </span>
            )}
          </div>
        )}

        {isFolder && isOpen && (
          <div role="group">
            {children.map((child) => renderRow(child, depth + 1))}
            {draft?.parentId === node.id && (
              <InlineInput
                depth={depth + 1}
                initial={draft.type === 'FILE' ? '' : ''}
                placeholder={draft.type === 'FILE' ? 'file-name.ts' : 'folder name'}
                icon={draft.type === 'FOLDER' ? 'folder' : undefined}
                onCommit={commitDraft}
                onCancel={() => setDraft(null)}
              />
            )}
            {children.length === 0 && draft?.parentId !== node.id && (
              <p className="tree-empty" style={{ paddingLeft: 10 + (depth + 1) * 15 }}>
                Empty folder
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const roots = childrenOf(room.tree, null);
  const menuNode = menu?.nodeId ? room.tree.find((node) => node.id === menu.nodeId) : null;

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Workspace</p>
          <h2>Explorer</h2>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-button"
            title="New file"
            onClick={() => startDraft('FILE')}
            disabled={room.readOnly}
          >
            <Icon name="filePlus" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="New folder"
            onClick={() => startDraft('FOLDER')}
            disabled={room.readOnly}
          >
            <Icon name="folderPlus" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Import a zip"
            onClick={() => fileInput.current?.click()}
            disabled={room.readOnly || importing}
          >
            <Icon name="upload" size={16} />
          </button>
          <button type="button" className="icon-button" title="Recycle bin" onClick={() => void openRecycleBin()}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onImport(file);
        }}
      />

      <div
        className={`tree-root${dropTarget === null ? ' is-drop-target' : ''}`}
        role="tree"
        aria-label="Project files"
        onDragOver={(event) => {
          if (!dragId) return;
          event.preventDefault();
          setDropTarget(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(null);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelectedId(null);
          setMenu({ x: event.clientX, y: event.clientY, nodeId: null });
        }}
      >
        <button
          type="button"
          className="tree-project"
          onClick={() => setSelectedId(null)}
          title="Project root"
        >
          <Icon name="chevronDown" size={15} />
          {roomName}
        </button>

        {roots.map((node) => renderRow(node, 0))}

        {draft?.parentId === null && (
          <InlineInput
            depth={0}
            initial=""
            placeholder={draft.type === 'FILE' ? 'file-name.ts' : 'folder name'}
            icon={draft.type === 'FOLDER' ? 'folder' : undefined}
            onCommit={commitDraft}
            onCancel={() => setDraft(null)}
          />
        )}

        {importing && <p className="tree-empty">Importing…</p>}

        {room.tree.length === 0 && !draft && !importing && (
          <div className="tree-blank">
            <p>No files yet.</p>
            {!room.readOnly && (
              <button type="button" className="button-quiet" onClick={() => startDraft('FILE')}>
                Create the first one
              </button>
            )}
          </div>
        )}
      </div>

      {menu && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <li>
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                startDraft('FILE');
              }}
              disabled={room.readOnly}
            >
              <Icon name="filePlus" size={14} /> New file
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setMenu(null);
                startDraft('FOLDER');
              }}
              disabled={room.readOnly}
            >
              <Icon name="folderPlus" size={14} /> New folder
            </button>
          </li>
          {menuNode && (
            <>
              <li className="context-divider" role="separator" />
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    setRenamingId(menuNode.id);
                  }}
                  disabled={room.readOnly}
                >
                  <Icon name="pencil" size={14} /> Rename
                </button>
              </li>
              {menuNode.parentId !== null && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(null);
                      room.move(menuNode.id, null);
                    }}
                    disabled={room.readOnly}
                  >
                    <Icon name="upload" size={14} /> Move to root
                  </button>
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setMenu(null);
                    confirmAndRemove(menuNode.id, menuNode.name, menuNode.type === 'FOLDER');
                  }}
                  disabled={room.readOnly}
                >
                  <Icon name="trash" size={14} /> Delete
                </button>
              </li>
            </>
          )}
        </ul>
      )}
      {pendingDelete && (
        <Modal title={`Delete ${pendingDelete.folder ? 'folder' : 'file'}?`} onClose={() => setPendingDelete(null)} width={400}>
          <div className="delete-confirm">
            <div className="delete-confirm-icon"><Icon name="trash" size={18} /></div>
            <div>
              <p className="delete-confirm-title">Move <b>{pendingDelete.name}</b> to the recycle bin?</p>
              <p className="muted">You can restore it later.</p>
            </div>
            <div className="delete-confirm-actions">
              <button type="button" className="button-quiet" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button type="button" className="button-danger" onClick={() => { room.remove(pendingDelete.id); setPendingDelete(null); }}>Move to bin</button>
            </div>
          </div>
        </Modal>
      )}
      {showRecycleBin && (
        <Modal title="Recycle bin" subtitle="Restore files and folders deleted from this room." onClose={() => setShowRecycleBin(false)} width={460}>
          <div className="recycle-bin">
            {loadingRecycleBin ? <p className="muted">Loading deleted items…</p> : recycleBin.length === 0 ? (
              <div className="recycle-empty"><Icon name="trash" size={24} /><p>The recycle bin is empty.</p></div>
            ) : recycleBin.map((item) => (
              <div className="recycle-item" key={item.id}>
                <Icon name={item.type === 'FOLDER' ? 'folder' : 'files'} size={16} />
                <div><b>{item.name}</b><small>Deleted {new Date(item.deletedAt).toLocaleString()}</small></div>
                <button type="button" className="button-quiet" disabled={room.readOnly} onClick={() => {
                  const restoring = new Set<string>([item.id]);
                  let changed = true;
                  while (changed) {
                    changed = false;
                    for (const candidate of recycleBin) {
                      if (candidate.parentId && restoring.has(candidate.parentId) && !restoring.has(candidate.id)) {
                        restoring.add(candidate.id);
                        changed = true;
                      }
                    }
                  }
                  // Parents must be put back before their children so the
                  // original folder layout is restored intact.
                  const selected = recycleBin.filter((entry) => restoring.has(entry.id));
                  const depthOf = (entry: TreeNode & { deletedAt: string }): number => {
                    let depth = 0;
                    let parentId = entry.parentId;
                    while (parentId) {
                      const parent = selected.find((candidate) => candidate.id === parentId);
                      if (!parent) break;
                      depth += 1;
                      parentId = parent.parentId;
                    }
                    return depth;
                  };
                  for (const entry of selected.sort((left, right) => depthOf(left) - depthOf(right))) room.restoreDeleted(entry);
                  setRecycleBin((current) => current.filter((entry) => !restoring.has(entry.id)));
                  toast(`Restored ${item.name}${restoring.size > 1 ? ` and ${restoring.size - 1} item${restoring.size === 2 ? '' : 's'}` : ''}.`);
                }}>Restore</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

type InlineInputProps = {
  depth: number;
  initial: string;
  placeholder?: string;
  icon?: 'folder';
  badge?: { badge: string; tint: string };
  onCommit: (value: string) => void;
  onCancel: () => void;
};

function InlineInput({
  depth,
  initial,
  placeholder,
  icon,
  badge,
  onCommit,
  onCancel,
}: InlineInputProps) {
  const [value, setValue] = useState(initial);

  return (
    <div className="tree-row is-editing" style={{ paddingLeft: 10 + depth * 15 }}>
      <span className="tree-twisty" />
      {icon ? (
        <Icon name="folder" size={16} className="tree-folder-icon" />
      ) : (
        badge && <span className={`file-badge tint-${badge.tint}`}>{badge.badge}</span>
      )}
      <input
        className="tree-input"
        value={value}
        placeholder={placeholder}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(value);
          else if (event.key === 'Escape') onCancel();
          else return;
          event.preventDefault();
        }}
      />
    </div>
  );
}
