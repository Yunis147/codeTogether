import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { MonacoBinding } from 'y-monaco';
import * as Y from 'yjs';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { monaco } from '../monaco/setup';
import type { ConnectionState, NodeType, Person, Role, TreeNode } from '../types';
import { languageFor } from './language';
import {
  CONTENT_TEXT_KEY,
  createNode,
  deleteNode,
  moveNode,
  readTree,
  renameNode,
  restoreNode,
  setNodeLanguage,
  treeMap,
  uniqueName,
} from './tree';

function treeDocumentName(roomId: string): string {
  return `room:${roomId}:tree`;
}

function fileDocumentName(roomId: string, fileId: string): string {
  return `room:${roomId}:file:${fileId}`;
}

function syncUrl(): string {
  const configured = import.meta.env.VITE_SYNC_URL;
  if (configured) return configured;

  if (import.meta.env.VITE_API_URL) {
    try {
      const parsed = new URL(import.meta.env.VITE_API_URL);
      const protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${parsed.host}/sync`;
    } catch {
      /* ignore */
    }
  }

  // Dev goes through Vite's /sync WebSocket proxy, which keeps sync on the same
  // origin as the API so the session cookie is sent either way.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/sync`;
}

/** Everything held open for one file the user has in a tab. */
type OpenDocument = {
  fileId: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  model: monaco.editor.ITextModel;
  binding: MonacoBinding;
  undoManager: Y.UndoManager;
};

export type RoomValue = {
  roomId: string;
  role: Role;
  readOnly: boolean;
  connection: ConnectionState;
  /** True while any document still has changes the server has not acknowledged. */
  unsaved: boolean;
  authError: string | null;

  tree: TreeNode[];
  people: Person[];

  openFileIds: string[];
  activeFileId: string | null;
  /** Open tabs whose node has been deleted from the tree by someone. */
  deletedFileIds: string[];

  attachEditor: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
  activeDocument: () => OpenDocument | null;
  documentFor: (fileId: string) => OpenDocument | null;
  /** Bumps whenever a document is created or destroyed, so views can re-bind. */
  documentsVersion: number;

  openFile: (fileId: string) => void;
  closeFile: (fileId: string) => void;
  focusFile: (fileId: string) => void;
  revealMatch: (fileId: string, line: number, column: number) => void;

  addFile: (parentId: string | null, name: string) => string | null;
  addFolder: (parentId: string | null, name: string) => string | null;
  rename: (fileId: string, name: string) => void;
  move: (fileId: string, parentId: string | null) => void;
  remove: (fileId: string) => void;
  setLanguage: (fileId: string, language: string) => void;
  restoreDeleted: (node: TreeNode) => void;
  restoreDeletedBatch: (nodes: TreeNode[]) => void;
  importFiles: (entries: { path: string; content: string }[]) => Promise<number>;

  undo: () => void;
  redo: () => void;

  followingId: string | null;
  setFollowingId: (identityId: string | null) => void;
  cursorPosition: { line: number; column: number };
};

const RoomContext = createContext<RoomValue | null>(null);

type RoomProviderProps = {
  roomId: string;
  role: Role;
  token: string | null;
  identity: { id: string; name: string; color: string };
  guest: boolean;
  children: ReactNode;
};

export function RoomProvider({
  roomId,
  role,
  token,
  identity,
  guest,
  children,
}: RoomProviderProps) {
  const [serverReadOnly, setServerReadOnly] = useState(role === 'VIEWER');
  const readOnly = role === 'VIEWER' || serverReadOnly;

  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [authError, setAuthError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [unsyncedTotal, setUnsyncedTotal] = useState(0);
  const [editorReady, setEditorReady] = useState(false);
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number }>({
    line: 1,
    column: 1,
  });


  const websocketRef = useRef<HocuspocusProviderWebsocket | null>(null);
  const treeProviderRef = useRef<HocuspocusProvider | null>(null);
  const treeDocRef = useRef<Y.Doc | null>(null);
  const documentsRef = useRef(new Map<string, OpenDocument>());
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const unsyncedRef = useRef(new Map<string, number>());
  const pendingRevealRef = useRef<{ fileId: string; line: number; column: number } | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    const aw = treeProviderRef.current?.awareness;
    if (!aw) return;
    aw.setLocalStateField('user', {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      role,
      guest,
    });
  }, [identity.id, identity.name, identity.color, role, guest]);

  const recomputeUnsynced = useCallback(() => {
    let total = 0;
    for (const count of unsyncedRef.current.values()) total += count;
    setUnsyncedTotal(total);
  }, []);

  const reportUnsynced = useCallback(
    (key: string, count: number) => {
      unsyncedRef.current.set(key, count);
      recomputeUnsynced();
    },
    [recomputeUnsynced],
  );

  // One WebSocket for the room; every document multiplexes over it.
  useEffect(() => {
    const websocket = new HocuspocusProviderWebsocket({ url: syncUrl() });
    websocket.on('status', ({ status }: { status: string }) => setConnection(status as ConnectionState));
    setConnection(websocket.status as ConnectionState);
    websocketRef.current = websocket;

    return () => {
      websocket.destroy();
      websocketRef.current = null;
    };
  }, [roomId]);

  const refreshCursorStyles = useCallback(() => {
    const providers = [
      treeProviderRef.current,
      ...Array.from(documentsRef.current.values()).map((d) => d.provider),
    ];
    let styleEl = document.getElementById('ct-remote-cursors') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ct-remote-cursors';
      document.head.appendChild(styleEl);
    }

    const map = new Map<number, { color: string; name: string }>();
    for (const p of providers) {
      const aw = p?.awareness;
      if (!aw) continue;
      for (const [clientId, state] of aw.getStates()) {
        if (clientId === aw.clientID) continue;
        const raw = state as { user?: { color?: string; name?: string } };
        if (raw.user?.color && raw.user?.name) {
          map.set(clientId, { color: raw.user.color, name: raw.user.name });
        }
      }
    }

    let css = '';
    for (const [clientId, { color, name }] of map) {
      const safeName = name.replace(/["\\]/g, '\\$&');
      css += `.yRemoteSelection-${clientId} { --remote-tint: ${color}33; }\n`;
      css += `.yRemoteSelectionHead-${clientId} { --remote-color: ${color}; --remote-name: "${safeName}"; }\n`;
    }
    styleEl.textContent = css;
  }, []);

  // The room's tree document, which also carries room-wide presence.
  useEffect(() => {
    const websocket = websocketRef.current;
    if (!websocket) return;

    const doc = new Y.Doc();
    let publishPresence: (() => void) | null = null;
    const provider = new HocuspocusProvider({
      websocketProvider: websocket,
      name: treeDocumentName(roomId),
      document: doc,
      token: token ?? '',
      onStatus: ({ status }) => setConnection(status as ConnectionState),
      onAuthenticated: ({ scope }) => {
        setConnection('connected');
        if (scope === 'readonly') {
          setServerReadOnly(true);
        }
        // An awareness update sent before authentication is not useful for
        // server-stamped identity. Announce once the connection is authorised.
        queueMicrotask(() => publishPresence?.());
      },
      onSynced: () => {
        setConnection('connected');
        publishPresence?.();
      },
      onAuthenticationFailed: ({ reason }) => {
        setConnection('disconnected');
        setAuthError(reason || 'You no longer have access to this room.');
      },
      onUnsyncedChanges: ({ number }) => reportUnsynced('tree', number),
    });
    provider.attach();

    treeDocRef.current = doc;
    treeProviderRef.current = provider;

    const map = treeMap(doc);
    const syncTree = (): void => setTree(readTree(doc));
    map.observeDeep(syncTree);
    syncTree();

    const awareness = provider.awareness;
    publishPresence = () => {
      if (!awareness) return;

      // The server replaces `user` with its authenticated identity before
      // peers see it, so this remains safe even if a client is modified.
      const curIdentity = identityRef.current;
      awareness.setLocalState({
        ...awareness.getLocalState(),
        user: {
          id: curIdentity.id,
          name: curIdentity.name,
          color: curIdentity.color,
          role,
          guest,
        },
      });
    };
    publishPresence();

    const syncPeople = (): void => {
      if (!awareness) return;

      const seen = new Map<string, Person>();

      for (const [clientId, state] of awareness.getStates()) {
        const raw = state as { user?: Partial<Person>; file?: unknown };
        const user = raw.user;
        if (!user?.name || !user.id || !user.color || !user.role) continue;

        const person: Person = {
          clientId,
          id: user.id,
          name: user.name,
          color: user.color,
          role: user.role,
          guest: Boolean(user.guest),
          avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
          fileId: typeof raw.file === 'string' ? raw.file : null,
          isYou: clientId === awareness.clientID,
        };

        // Keyed by identity rather than client id: one person with two tabs
        // appears once, and a client that injects extra awareness entries cannot
        // pad the list, since the server stamps them all with its own identity.
        const existing = seen.get(person.id);
        if (!existing || person.isYou) seen.set(person.id, person);
      }

      setPeople(
        Array.from(seen.values()).sort((left, right) => {
          if (left.isYou !== right.isYou) return left.isYou ? -1 : 1;
          return left.name.localeCompare(right.name);
        }),
      );
    };

    awareness?.on('change', syncPeople);
    syncPeople();

    awareness?.on('change', refreshCursorStyles);
    refreshCursorStyles();

    const unsynced = unsyncedRef.current;

    return () => {
      awareness?.off('change', syncPeople);
      awareness?.off('change', refreshCursorStyles);
      const styleEl = document.getElementById('ct-remote-cursors');
      if (styleEl) styleEl.remove();
      map.unobserveDeep(syncTree);
      provider.destroy();
      doc.destroy();
      treeProviderRef.current = null;
      treeDocRef.current = null;
      unsynced.delete('tree');
      recomputeUnsynced();
    };
  }, [roomId, token, identity.id, guest, role, reportUnsynced, recomputeUnsynced, refreshCursorStyles]);

  // Open the first file once the tree arrives, so the editor is never empty on initial load.
  useEffect(() => {
    if (activeFileId !== null || tree.length === 0) return;

    const first = tree
      .filter((node) => node.type === 'FILE')
      .sort((left, right) => left.name.localeCompare(right.name))[0];

    if (first) {
      setOpenFileIds([first.id]);
      setActiveFileId(first.id);
    }
  }, [tree, activeFileId]);

  const attachEditor = useCallback((editor: monaco.editor.IStandaloneCodeEditor | null) => {
    editorRef.current = editor;
    setEditorReady(editor !== null);
    if (editor) {
      editor.onDidChangeCursorPosition((e) => {
        setCursorPosition({ line: e.position.lineNumber, column: e.position.column });
      });
    }
  }, []);

  const destroyDocument = useCallback(
    (open: OpenDocument) => {
      open.provider.awareness?.off('change', refreshCursorStyles);
      open.undoManager.destroy();
      open.binding.destroy();
      open.provider.destroy();
      open.doc.destroy();
      open.model.dispose();
      unsyncedRef.current.delete(open.fileId);
      recomputeUnsynced();
      refreshCursorStyles();
    },
    [recomputeUnsynced, refreshCursorStyles],
  );

  // Reconcile live documents against the open tabs. Documents are created only
  // once the editor exists, because the Monaco binding needs it.
  useEffect(() => {
    const websocket = websocketRef.current;
    const editor = editorRef.current;
    if (!websocket || !editor) return;

    const live = documentsRef.current;

    let changed = false;

    for (const fileId of openFileIds) {
      if (live.has(fileId)) continue;

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        websocketProvider: websocket,
        name: fileDocumentName(roomId, fileId),
        document: doc,
        token: token ?? '',
        onUnsyncedChanges: ({ number }) => reportUnsynced(fileId, number),
      });
      provider.attach();

      const text = doc.getText(CONTENT_TEXT_KEY);
      const liveTree = treeDocRef.current ? readTree(treeDocRef.current) : tree;
      const node = liveTree.find((n) => n.id === fileId) ?? tree.find((n) => n.id === fileId);
      const fileName = node?.name ?? 'file.txt';
      const fileLang = node?.language ?? (node ? languageFor(node.name) : 'plaintext');
      const uri = monaco.Uri.parse(`file:///${roomId}/${fileId}/${fileName}`);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel('', fileLang, uri);
      if (fileLang) {
        monaco.editor.setModelLanguage(model, fileLang);
      }
      provider.awareness?.on('change', refreshCursorStyles);
      const binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness);

      // Tracking only this binding's transactions is what makes undo per-user:
      // remote edits arrive with the provider as their origin and are skipped.
      const undoManager = new Y.UndoManager(text, { trackedOrigins: new Set([binding]) });

      live.set(fileId, { fileId, doc, provider, model, binding, undoManager });
      changed = true;
      refreshCursorStyles();
    }

    for (const [fileId, open] of live) {
      if (!openFileIds.includes(fileId)) {
        destroyDocument(open);
        live.delete(fileId);
        changed = true;
      }
    }

    if (changed) {
      setDocumentsVersion((v) => v + 1);
    }
  }, [openFileIds, roomId, token, editorReady, reportUnsynced, destroyDocument, tree, refreshCursorStyles]);

  useEffect(() => {
    const live = documentsRef.current;
    return () => {
      for (const open of live.values()) destroyDocument(open);
      live.clear();
    };
  }, [destroyDocument]);

  // Tell the room which file this client is looking at, for the collaborator
  // list and for anyone following.
  useEffect(() => {
    treeProviderRef.current?.awareness?.setLocalStateField('file', activeFileId);
  }, [activeFileId, connection]);

  const documentFor = useCallback(
    (fileId: string) => documentsRef.current.get(fileId) ?? null,
    [],
  );

  const activeDocument = useCallback(
    () => (activeFileId ? documentsRef.current.get(activeFileId) ?? null : null),
    [activeFileId],
  );

  const openFile = useCallback((fileId: string) => {
    setOpenFileIds((current) => (current.includes(fileId) ? current : [...current, fileId]));
    setActiveFileId(fileId);
  }, []);

  const focusFile = useCallback((fileId: string) => setActiveFileId(fileId), []);

  const closeFile = useCallback((fileId: string) => {
    setOpenFileIds((current) => {
      const next = current.filter((id) => id !== fileId);

      setActiveFileId((active) => {
        if (active !== fileId) return active;
        const index = current.indexOf(fileId);
        return next[index] ?? next[index - 1] ?? next[next.length - 1] ?? null;
      });

      return next;
    });
  }, []);

  // Sync the active document's Monaco model to the editor whenever activeFileId changes
  // or when the document becomes ready.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeFileId) return;

    const open = documentsRef.current.get(activeFileId);
    if (!open) return;

    if (editor.getModel() !== open.model) {
      editor.setModel(open.model);
    }

    const node = tree.find((n) => n.id === activeFileId);
    if (node?.language) {
      monaco.editor.setModelLanguage(open.model, node.language);
    }
  }, [activeFileId, documentsVersion, editorReady, tree]);

  /**
   * Search results and follow mode both need to jump to a position in a file
   * that may not be open yet. The request is parked until the document and its
   * model exist, then applied by the editor host.
   */
  const revealMatch = useCallback(
    (fileId: string, line: number, column: number) => {
      pendingRevealRef.current = { fileId, line, column };
      openFile(fileId);
    },
    [openFile],
  );

  useEffect(() => {
    const pending = pendingRevealRef.current;
    const editor = editorRef.current;
    if (!pending || !editor || pending.fileId !== activeFileId) return;

    const open = documentsRef.current.get(pending.fileId);
    if (!open || editor.getModel() !== open.model) return;

    pendingRevealRef.current = null;
    editor.revealLineInCenter(pending.line);
    editor.setPosition({ lineNumber: pending.line, column: pending.column });
    editor.focus();
  }, [activeFileId, tree, openFileIds, documentsVersion]);

  const withTree = useCallback(
    <T,>(action: (doc: Y.Doc, nodes: TreeNode[]) => T): T | null => {
      const doc = treeDocRef.current;
      if (!doc || readOnly) return null;
      return action(doc, readTree(doc));
    },
    [readOnly],
  );

  const addNode = useCallback(
    (parentId: string | null, name: string, type: NodeType): string | null =>
      withTree((doc, nodes) => {
        const id = crypto.randomUUID();
        createNode(doc, { id, parentId, name: uniqueName(nodes, parentId, name), type });
        return id;
      }),
    [withTree],
  );

  const addFile = useCallback(
    (parentId: string | null, name: string) => {
      const id = addNode(parentId, name, 'FILE');
      if (id) openFile(id);
      return id;
    },
    [addNode, openFile],
  );

  const addFolder = useCallback(
    (parentId: string | null, name: string) => addNode(parentId, name, 'FOLDER'),
    [addNode],
  );

  const rename = useCallback(
    (fileId: string, name: string) => {
      withTree((doc, nodes) => {
        const node = nodes.find((entry) => entry.id === fileId);
        if (!node) return;
        renameNode(doc, fileId, uniqueName(nodes, node.parentId, name.trim(), fileId));
      });
    },
    [withTree],
  );

  const move = useCallback(
    (fileId: string, parentId: string | null) => {
      withTree((doc) => moveNode(doc, fileId, parentId));
    },
    [withTree],
  );

  const remove = useCallback(
    (fileId: string) => {
      const removed = withTree((doc, nodes) => deleteNode(doc, nodes, fileId));
      if (!removed) return;

      setOpenFileIds((current) => current.filter((id) => !removed.includes(id)));
      setActiveFileId((current) => (current && removed.includes(current) ? null : current));
    },
    [withTree],
  );

  const setLanguage = useCallback(
    (fileId: string, language: string) => {
      withTree((doc) => setNodeLanguage(doc, fileId, language));
    },
    [withTree],
  );

  const restoreDeleted = useCallback(
    (node: TreeNode) => {
      withTree((doc, nodes) => {
        const parentExists = node.parentId === null || nodes.some((entry) => entry.id === node.parentId);
        restoreNode(doc, { ...node, parentId: parentExists ? node.parentId : null });
      });
      if (node.type === 'FILE') {
        openFile(node.id);
      }
    },
    [withTree, openFile],
  );

  const restoreDeletedBatch = useCallback(
    (nodesToRestore: TreeNode[]) => {
      withTree((doc, currentNodes) => {
        const currentIds = new Set(currentNodes.map((n) => n.id));
        doc.transact(() => {
          for (const node of nodesToRestore) {
            const parentExists = node.parentId === null || currentIds.has(node.parentId);
            restoreNode(doc, { ...node, parentId: parentExists ? node.parentId : null });
            currentIds.add(node.id);
          }
        });
      });
      const firstFile = nodesToRestore.find((n) => n.type === 'FILE');
      if (firstFile) {
        openFile(firstFile.id);
      }
    },
    [withTree, openFile],
  );

  /**
   * Import writes through Yjs rather than an upload endpoint, so every peer sees
   * the files appear live and a viewer is stopped by the same read-only
   * connection that stops typing.
   */
  const importFiles = useCallback(
    async (entries: { path: string; content: string }[]): Promise<number> => {
      const doc = treeDocRef.current;
      const websocket = websocketRef.current;
      if (!doc || !websocket || readOnly) return 0;

      const folders = new Map<string, string>();
      let created = 0;

      const folderFor = (segments: string[]): string | null => {
        let parentId: string | null = null;
        let path = '';

        for (const segment of segments) {
          path = path ? `${path}/${segment}` : segment;
          const known = folders.get(path);

          if (known) {
            parentId = known;
            continue;
          }

          const nodes = readTree(doc);
          const existing = nodes.find(
            (node) =>
              node.parentId === parentId && node.type === 'FOLDER' && node.name === segment,
          );

          const id = existing?.id ?? crypto.randomUUID();
          if (!existing) {
            createNode(doc, { id, parentId, name: segment, type: 'FOLDER' });
          }

          folders.set(path, id);
          parentId = id;
        }

        return parentId;
      };

      for (const entry of entries) {
        const segments = entry.path.split('/').filter(Boolean);
        const name = segments.pop();
        if (!name) continue;

        const parentId = folderFor(segments);
        const nodes = readTree(doc);
        const fileId = crypto.randomUUID();

        createNode(doc, {
          id: fileId,
          parentId,
          name: uniqueName(nodes, parentId, name),
          type: 'FILE',
        });

        // Content goes into the file's own document. Each one is opened just
        // long enough to write and flush, then closed again.
        const fileDoc = new Y.Doc();
        const initialSyncState = { resolve: (): void => {} };
        const flushState = { resolve: (): void => {} };
        let waitingForFlush = false;
        const initialSync = new Promise<void>((resolve) => {
          initialSyncState.resolve = resolve;
        });
        const flush = new Promise<void>((resolve) => {
          flushState.resolve = resolve;
        });
        const provider = new HocuspocusProvider({
          websocketProvider: websocket,
          name: fileDocumentName(roomId, fileId),
          document: fileDoc,
          token: token ?? '',
          // These callbacks are registered before attach(), unlike the old
          // event handlers. A fast connection therefore cannot emit the
          // completion event before import starts listening for it.
          onSynced: ({ state }) => {
            if (state) initialSyncState.resolve();
          },
          onUnsyncedChanges: ({ number }) => {
            if (waitingForFlush && number === 0) flushState.resolve();
          },
        });
        provider.attach();

        await Promise.race([
          initialSync,
          new Promise<void>((resolve) => window.setTimeout(resolve, 5_000)),
        ]);

        waitingForFlush = true;
        fileDoc.getText(CONTENT_TEXT_KEY).insert(0, entry.content);
        // If a provider already acknowledged the local update by the time the
        // synchronous Yjs transaction returns, there is no event left to wait
        // for. Otherwise the pre-registered callback resolves the promise.
        if (!provider.hasUnsyncedChanges) flushState.resolve();
        await Promise.race([
          flush,
          new Promise<void>((resolve) => window.setTimeout(resolve, 5_000)),
        ]);

        provider.destroy();
        fileDoc.destroy();
        created += 1;
      }

      return created;
    },
    [readOnly, roomId, token],
  );

  const undo = useCallback(() => activeDocument()?.undoManager.undo(), [activeDocument]);
  const redo = useCallback(() => activeDocument()?.undoManager.redo(), [activeDocument]);

  // Following someone means going where they go: when their open file changes,
  // open it here too.
  useEffect(() => {
    if (!followingId) return;

    const target = people.find((person) => person.id === followingId && !person.isYou);
    if (!target) {
      setFollowingId(null);
      return;
    }

    if (target.fileId && target.fileId !== activeFileId) openFile(target.fileId);
  }, [followingId, people, activeFileId, openFile]);

  const knownIds = useMemo(() => new Set(tree.map((node) => node.id)), [tree]);

  const deletedFileIds = useMemo(
    // Before the tree has loaded, nothing is known to be missing.
    () => (tree.length === 0 ? [] : openFileIds.filter((id) => !knownIds.has(id))),
    [openFileIds, knownIds, tree.length],
  );

  const value = useMemo<RoomValue>(
    () => ({
      roomId,
      role,
      readOnly,
      connection,
      unsaved: unsyncedTotal > 0,
      authError,
      tree,
      people,
      openFileIds,
      activeFileId,
      deletedFileIds,
      attachEditor,
      activeDocument,
      documentFor,
      documentsVersion,
      openFile,
      closeFile,
      focusFile,
      revealMatch,
      addFile,
      addFolder,
      rename,
      move,
      remove,
      setLanguage,
      restoreDeleted,
      restoreDeletedBatch,
      importFiles,
      undo,
      redo,
      followingId,
      setFollowingId,
      cursorPosition,
    }),
    [
      roomId,
      role,
      readOnly,
      connection,
      unsyncedTotal,
      authError,
      tree,
      people,
      openFileIds,
      activeFileId,
      deletedFileIds,
      attachEditor,
      activeDocument,
      documentFor,
      documentsVersion,
      openFile,
      closeFile,
      focusFile,
      revealMatch,
      addFile,
      addFolder,
      rename,
      move,
      remove,
      setLanguage,
      restoreDeleted,
      restoreDeletedBatch,
      importFiles,
      undo,
      redo,
      followingId,
      cursorPosition,
    ],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error('useRoom must be used inside a RoomProvider.');
  return value;
}

export function useActiveNode(): TreeNode | null {
  const { tree, activeFileId } = useRoom();
  return useMemo(
    () => tree.find((node) => node.id === activeFileId) ?? null,
    [tree, activeFileId],
  );
}

export { languageFor };
