import { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';

import { api } from './api';
import { useRoute, navigate } from './hooks/useRoute';
import { useLocalSetting } from './hooks/useLocalSetting';
import { SessionProvider, useSession } from './session/SessionProvider';
import { PreferencesProvider, usePreferences } from './settings/PreferencesProvider';
import { ToastProvider, useToast } from './ui/Toast';
import { Modal } from './ui/Modal';
import { Icon, Brand } from './ui/Icon';
import { Avatar, AvatarStack, colorFor } from './ui/Avatar';
import { Resizer } from './workspace/Resizer';
import { FilesPanel } from './workspace/FilesPanel';
import { SearchPanel } from './workspace/SearchPanel';
import { RoomsPanel } from './workspace/RoomsPanel';
import { SettingsPanel } from './workspace/SettingsPanel';
import { ChatPanel, type LiveRoomPerson } from './workspace/ChatPanel';
import { EditorTabs } from './workspace/EditorTabs';
import { OutputPanel, type LogEntry, type ProblemEntry } from './workspace/OutputPanel';
import { CollaboratorList } from './workspace/CollaboratorList';
import { RoomProvider, useRoom, useActiveNode } from './workspace/RoomProvider';
import { languageLabel, LANGUAGE_CHOICES } from './workspace/language';
import { CONTENT_TEXT_KEY } from './workspace/tree';
import { editorThemeFor, monaco } from './monaco/setup';
import './monaco/setup';
import type { ConnectionState, Person, RoomDetail, ShareLink, Member, Role } from './types';

// ─── Workspace Entry Helper ──────────────────────────────────────────────────

async function enterWorkspace(targetRoomId?: string): Promise<void> {
  if (targetRoomId) {
    localStorage.setItem('codetogether.lastRoomId', targetRoomId);
    navigate({ name: 'room', roomId: targetRoomId }, { replace: true });
    return;
  }

  const storedRoomId = localStorage.getItem('codetogether.lastRoomId');

  try {
    const { owned, shared } = await api<{
      owned: Array<{ id: string; name: string }>;
      shared: Array<{ id: string; name: string }>;
    }>('/api/rooms');

    const allRooms = [...owned, ...shared];

    // If storedRoomId is among the user's accessible rooms, use it
    if (storedRoomId && allRooms.some((r) => r.id === storedRoomId)) {
      navigate({ name: 'room', roomId: storedRoomId }, { replace: true });
      return;
    }

    // Otherwise, if user has any rooms, pick the first one
    if (allRooms.length > 0) {
      const firstId = allRooms[0].id;
      localStorage.setItem('codetogether.lastRoomId', firstId);
      navigate({ name: 'room', roomId: firstId }, { replace: true });
      return;
    }

    // If new user with 0 rooms, automatically create a default workspace room
    const result = await api<{ room: { id: string } }>('/api/rooms', {
      method: 'POST',
      body: { name: 'workspace' },
    });
    localStorage.setItem('codetogether.lastRoomId', result.room.id);
    navigate({ name: 'room', roomId: result.room.id }, { replace: true });
  } catch {
    if (storedRoomId) {
      navigate({ name: 'room', roomId: storedRoomId }, { replace: true });
    }
  }
}

// ─── Auth landing pages ───────────────────────────────────────────────────────

function LandingPage() {
  const { signIn, signUp } = useSession();
  const [tab, setTab] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      const roomId = tab === 'signup'
        ? await signUp({ name, email, password })
        : await signIn({ email, password });

      // Router owns ordinary workspace entry. A guest who just authenticated
      // needs an explicit destination so the router cannot create a fresh room
      // while the linked room is being opened.
      if (roomId) {
        localStorage.setItem('codetogether.lastRoomId', roomId);
        navigate({ name: 'room', roomId }, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="landing-brand">
          <Brand />
        </div>
        <p className="landing-tagline">Real-time collaborative code editor</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={tab === 'signin' ? 'is-active' : ''}
            onClick={() => setTab('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            className={tab === 'signup' ? 'is-active' : ''}
            onClick={() => setTab('signup')}
          >
            Create account
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {tab === 'signup' && (
            <label className="field-label">
              <span>Display name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
              />
            </label>
          )}
          <label className="field-label">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label className="field-label">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="button-primary button-full" disabled={busy}>
            {busy ? 'Please wait…' : tab === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Join via share link ───────────────────────────────────────────────────────

function JoinPage({ token }: { token: string }) {
  const { user, startGuestSession } = useSession();
  const [info, setInfo] = useState<{
    room: { id: string; name: string; ownerName: string };
    role: Role;
    signedInAs: { name: string } | null;
  } | null>(null);
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<typeof info>(`/api/share/${token}`)
      .then((data) => {
        setInfo(data);
        if (data?.signedInAs) setGuestName(data.signedInAs.name);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Link not found.'))
      .finally(() => setLoading(false));
  }, [token]);

  const join = async (): Promise<void> => {
    if (!info) return;
    setBusy(true);
    setError('');

    try {
      const result = await api<{
        room: { id: string; name: string; ownerName: string };
        role: Role;
        member: boolean;
        guest?: { id: string; name: string };
        token?: string;
      }>(`/api/share/${token}/join`, {
        method: 'POST',
        body: user ? {} : { name: guestName.trim() },
      });

      if (!result.member && result.guest && result.token) {
        startGuestSession({
          id: result.guest.id,
          name: result.guest.name,
          roomId: result.room.id,
          role: result.role,
          token: result.token,
        });
      }

      navigate({ name: 'room', roomId: result.room.id }, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <Icon name="refresh" size={22} className="spin" />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="landing">
        <div className="landing-card">
          <Brand />
          <p className="auth-error" style={{ marginTop: 24 }}>
            {error}
          </p>
          <button
            type="button"
            className="button-quiet button-full"
            style={{ marginTop: 12 }}
            onClick={() => navigate({ name: 'landing' })}
          >
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <Brand />
        <div className="join-room-info">
          <p className="eyebrow">You were invited to</p>
          <h2>{info?.room.name}</h2>
          <p className="muted">
            by {info?.room.ownerName} · {info?.role.toLowerCase()} access
          </p>
        </div>

        {!user && (
          <label className="field-label">
            <span>Your display name</span>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Enter your name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void join();
              }}
            />
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}

        <button
          type="button"
          className="button-primary button-full"
          onClick={() => void join()}
          disabled={busy || (!user && guestName.trim().length < 2)}
        >
          {busy ? 'Joining…' : `Join as ${info?.role.toLowerCase()}`}
        </button>

        {!user && (
          <p className="panel-note" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="text-button"
              onClick={() => navigate({ name: 'landing' })}
            >
              Sign in
            </button>{' '}
            to keep your rooms saved.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Rooms list page ───────────────────────────────────────────────────────────

function RoomsPage() {
  const { user, signOut } = useSession();
  const toast = useToast();
  const [owned, setOwned] = useState<Array<{ id: string; name: string; updatedAt: string }>>([]);
  const [shared, setShared] = useState<Array<{ id: string; name: string; role: string; ownerName: string; updatedAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<{ owned: typeof owned; shared: typeof shared }>('/api/rooms');
      setOwned(result.owned);
      setShared(result.shared);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      navigate({ name: 'landing' });
      return;
    }
    void load();
  }, [user, load]);

  const create = async (): Promise<void> => {
    const trimmed = roomName.trim();
    if (trimmed.length < 2) {
      toast('Room name needs at least 2 characters.', 'error');
      return;
    }
    try {
      const result = await api<{ room: { id: string } }>('/api/rooms', {
        method: 'POST',
        body: { name: trimmed },
      });
      navigate({ name: 'room', roomId: result.room.id });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create room.', 'error');
    }
  };

  return (
    <div className="rooms-page">
      <header className="rooms-header">
        <Brand />
        <div className="rooms-header-actions">
          {user && (
            <>
              <Avatar name={user.name} color={user.color} size={28} title={user.email} />
              <button
                type="button"
                className="button-quiet"
                onClick={async () => {
                  await signOut();
                  navigate({ name: 'landing' });
                }}
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="rooms-main">
        <div className="rooms-greeting">
          <h1>
            Good{' '}
            {new Date().getHours() < 12
              ? 'morning'
              : new Date().getHours() < 18
                ? 'afternoon'
                : 'evening'}
            , {user?.name.split(' ')[0]}
          </h1>
          <p className="muted">Pick a room to continue, or start a new one.</p>
        </div>

        <div className="rooms-new">
          {creating ? (
            <div className="rooms-create-form">
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Room name, e.g. algo-playground"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  else if (e.key === 'Escape') setCreating(false);
                }}
              />
              <button type="button" className="button-primary" onClick={() => void create()}>
                Create
              </button>
              <button type="button" className="button-quiet" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button-primary"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={15} />
              New room
            </button>
          )}
        </div>

        {loading ? (
          <div className="rooms-loading">
            <Icon name="refresh" size={20} className="spin" />
            <span>Loading your rooms…</span>
          </div>
        ) : (
          <div className="rooms-grid">
            {owned.length === 0 && shared.length === 0 ? (
              <div className="rooms-empty">
                <Icon name="rooms" size={32} />
                <p>No rooms yet. Create one to get started.</p>
              </div>
            ) : (
              <>
                {owned.length > 0 && (
                  <section>
                    <p className="eyebrow">My rooms</p>
                    <div className="room-cards">
                      {owned.map((room) => (
                        <button
                          key={room.id}
                          type="button"
                          className="room-card"
                          onClick={() => navigate({ name: 'room', roomId: room.id })}
                        >
                          <span className="room-card-icon">
                            <Icon name="rooms" size={18} />
                          </span>
                          <span className="room-card-body">
                            <strong>{room.name}</strong>
                            <small>Owner</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {shared.length > 0 && (
                  <section>
                    <p className="eyebrow">Shared with me</p>
                    <div className="room-cards">
                      {shared.map((room) => (
                        <button
                          key={room.id}
                          type="button"
                          className="room-card"
                          onClick={() => navigate({ name: 'room', roomId: room.id })}
                        >
                          <span className="room-card-icon">
                            <Icon name="rooms" size={18} />
                          </span>
                          <span className="room-card-body">
                            <strong>{room.name}</strong>
                            <small>
                              {room.role.charAt(0) + room.role.slice(1).toLowerCase()} ·{' '}
                              {room.ownerName}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Share dialog ─────────────────────────────────────────────────────────────

function ShareDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [creating, setCreating] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [createdLinkId, setCreatedLinkId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ links: ShareLink[] }>(`/api/rooms/${roomId}/links`),
      api<{ members: Member[] }>(`/api/rooms/${roomId}/members`),
    ])
      .then(([linksResult, membersResult]) => {
        setLinks(Array.from(new Map(linksResult.links.map((l) => [l.id, l])).values()));
        setMembers(membersResult.members);
      })
      .catch(() => toast('Could not load share info.', 'error'))
      .finally(() => {});
  }, [roomId, toast]);

  const createLink = async (): Promise<void> => {
    setCreating(true);
    try {
      const result = await api<{ link: ShareLink }>(`/api/rooms/${roomId}/links`, {
        method: 'POST',
        body: { role },
      });
      setLinks((prev) => [...prev.filter((l) => l.id !== result.link.id), result.link]);
      setCreatedLinkId(result.link.id);
      toast(`${role === 'EDITOR' ? 'Editor' : 'Viewer'} link ready. Copy the highlighted link below.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create link.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const revokeLink = async (linkId: string): Promise<void> => {
    try {
      await api(`/api/rooms/${roomId}/links/${linkId}`, { method: 'DELETE' });
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      toast('Link revoked.');
    } catch {
      toast('Could not revoke link.', 'error');
    }
  };

  const copyLink = async (link: ShareLink): Promise<void> => {
    const token = link.token;
    const url = `${window.location.origin}/join/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(link.id);
      toast('Link copied.');
    } catch {
      toast('Could not copy link.', 'error');
    }
  };

  const updateRole = async (memberId: string, newRole: Role): Promise<void> => {
    try {
      await api(`/api/rooms/${roomId}/members/${memberId}`, {
        method: 'PATCH',
        body: { role: newRole },
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update role.', 'error');
    }
  };

  const removeMember = async (memberId: string): Promise<void> => {
    try {
      await api(`/api/rooms/${roomId}/members/${memberId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch {
      toast('Could not remove member.', 'error');
    }
  };

  return (
    <Modal title="Share room" onClose={onClose} width={500}>
      <div className="share-dialog">
        {/* Create new link */}
        <section className="share-section">
          <p className="eyebrow">Create an invite link</p>
          <div className="share-link-row">
            <select
              className="share-role-select"
              value={role}
              onChange={(e) => setRole(e.target.value as 'EDITOR' | 'VIEWER')}
            >
              <option value="EDITOR">Can edit</option>
              <option value="VIEWER">Can view</option>
            </select>
            <button
              type="button"
              className="button-primary"
              onClick={() => void createLink()}
              disabled={creating}
            >
              <Icon name="link" size={14} />
              {creating ? 'Creating…' : `Create ${role === 'EDITOR' ? 'editor' : 'viewer'} link`}
            </button>
          </div>

          {links.length > 0 && (
            <div className="share-links">
              <p className="panel-note">Active links stay valid until you revoke them.</p>
              {links.map((link) => {
                const url = `${window.location.origin}/join/${link.token}`;
                return (
                  <div key={link.id} className={`share-link-item${createdLinkId === link.id ? ' is-new' : ''}`}>
                    <span className="share-link-role">
                      {link.role === 'EDITOR' ? 'Can edit' : 'Can view'}
                    </span>
                    <input readOnly value={url} className="share-link-input" />
                    <button
                      type="button"
                      className="icon-button"
                      title={copiedLinkId === link.id ? 'Copied' : 'Copy link'}
                      aria-label={copiedLinkId === link.id ? 'Link copied' : 'Copy invite link'}
                      onClick={() => void copyLink(link)}
                    >
                      <Icon name={copiedLinkId === link.id ? 'check' : 'copy'} size={14} />
                    </button>
                    {createdLinkId === link.id && <span className="share-link-new">New</span>}
                    <button
                      type="button"
                      className="icon-button is-danger"
                      title="Revoke link"
                      onClick={() => void revokeLink(link.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Members list */}
        {members.length > 0 && (
          <section className="share-section">
            <p className="eyebrow">Members</p>
            <div className="share-members">
              {members.map((member) => (
                <div key={member.id} className="share-member">
                  <Avatar name={member.name} color={colorFor(member.id)} size={28} />
                  <div className="share-member-info">
                    <strong>{member.name}</strong>
                    <small>{member.email ?? 'Guest'}</small>
                  </div>
                  {member.role === 'OWNER' ? (
                    <span className="role-chip">Owner</span>
                  ) : member.isYou ? (
                    <span className="role-chip">{member.role.toLowerCase()}</span>
                  ) : (
                    <>
                      <select
                        className="share-role-select"
                        value={member.role}
                        onChange={(e) => void updateRole(member.id, e.target.value as Role)}
                      >
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>
                      <button
                        type="button"
                        className="icon-button is-danger"
                        title="Remove member"
                        onClick={() => void removeMember(member.id)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

function RenameRoomDialog({
  roomId,
  currentName,
  onClose,
  onRenamed,
}: {
  roomId: string;
  currentName: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast('Room names need at least 2 characters.', 'error');
      return;
    }
    if (trimmed === currentName) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const result = await api<{ room: { name: string } }>(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        body: { name: trimmed },
      });
      onRenamed(result.room.name);
      toast('Room renamed. Everyone has been notified in chat.');
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not rename room.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Rename room" onClose={onClose} width={420}>
      <form
        className="share-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field-label" htmlFor="room-name">Room name</label>
        <input id="room-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={60} />
        <div className="modal-actions">
          <button type="button" className="button-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="button-primary" disabled={saving}>{saving ? 'Renaming…' : 'Rename room'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Deleted file banner ───────────────────────────────────────────────────────

function DeletedFileBanner({ fileId }: { fileId: string }) {
  const room = useRoom();
  return (
    <div className="deleted-banner">
      <Icon name="warning" size={14} />
      <span>This file was deleted by another collaborator.</span>
      <button type="button" className="icon-button" onClick={() => room.closeFile(fileId)}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

// ─── Editor area ──────────────────────────────────────────────────────────────

function EditorArea({ outputDrawer }: { outputDrawer?: React.ReactNode }) {
  const room = useRoom();
  const { theme, fontSize } = usePreferences();

  const isDeleted = room.activeFileId
    ? room.deletedFileIds.includes(room.activeFileId)
    : false;

  if (room.openFileIds.length === 0) {
    return (
      <div className="editor-area">
        <div className="editor-empty">
          <div className="editor-empty-content">
            <Icon name="files" size={36} />
            <h3>No file open</h3>
            <p className="muted">Select a file from the explorer to start editing.</p>
            {!room.readOnly && (
              <button
                type="button"
                className="button-quiet"
                onClick={() => room.addFile(null, 'untitled.ts')}
              >
                <Icon name="filePlus" size={14} />
                Create a file
              </button>
            )}
          </div>
        </div>
        {outputDrawer}
        <EditorStatusBar />
      </div>
    );
  }

  return (
    <div className="editor-area">
      <EditorTabs />
      {isDeleted && room.activeFileId && (
        <DeletedFileBanner fileId={room.activeFileId} />
      )}
      <div className="editor-pane">
        <CollaborativeMonacoEditor
          isDeleted={isDeleted}
          theme={theme}
          fontSize={fontSize}
        />
      </div>
      {outputDrawer}
      <EditorStatusBar />
    </div>
  );
}

/**
 * Single Monaco editor shared by all open files.
 * RoomProvider swaps the underlying model when the active file changes;
 * the editor itself stays mounted and just receives a new content source.
 */
function CollaborativeMonacoEditor({
  isDeleted,
  theme,
  fontSize,
}: {
  isDeleted: boolean;
  theme: 'dark' | 'light';
  fontSize: number;
}) {
  const room = useRoom();
  const activeNode = useActiveNode();

  const mount: OnMount = (editor) => {
    room.attachEditor(editor);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => room.undo());
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      () => room.redo(),
    );
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => room.redo());
  };

  return (
    <Editor
      language={activeNode?.language ?? 'plaintext'}
      theme={editorThemeFor(theme)}
      onMount={mount}
      options={{
        automaticLayout: true,
        fontSize,
        minimap: { enabled: false },
        padding: { top: 16, bottom: 16 },
        scrollBeyondLastLine: false,
        readOnly: room.readOnly || isDeleted,
        wordWrap: 'off',
        renderLineHighlight: 'gutter',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        lineNumbersMinChars: 4,
        overviewRulerBorder: false,
        folding: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        renderWhitespace: 'selection',
        quickSuggestions: { other: true, comments: true, strings: true },
        suggestOnTriggerCharacters: true,
        tabCompletion: 'on',
        acceptSuggestionOnEnter: 'on',
        parameterHints: { enabled: true },
        suggest: {
          showKeywords: true,
          showSnippets: true,
          showFunctions: true,
          showVariables: true,
        },
      }}
    />
  );
}

function EditorStatusBar() {
  const room = useRoom();
  const activeNode = useActiveNode();

  const connectionLabel: Record<ConnectionState, string> = {
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Offline',
  };

  const connectionClass: Record<ConnectionState, string> = {
    connecting: 'status-connecting',
    connected: 'status-connected',
    disconnected: 'status-offline',
  };

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className={`status-dot ${connectionClass[room.connection]}`} />
        <span>{connectionLabel[room.connection]}</span>
        {room.unsaved && <span className="statusbar-unsaved">● Saving…</span>}
        {!room.unsaved && room.connection === 'connected' && (
          <span className="statusbar-saved">✓ Saved</span>
        )}
      </div>
      <div className="statusbar-right">
        {room.authError && (
          <span className="statusbar-error">
            <Icon name="warning" size={11} /> {room.authError}
          </span>
        )}
        {activeNode && (
          <>
            <span>Ln {room.cursorPosition.line}, Col {room.cursorPosition.column}</span>
            <span className="statusbar-divider" />
            <label className="statusbar-lang-label" title="Change file language">
              <select
                className="statusbar-lang-select"
                value={activeNode.language ?? 'plaintext'}
                disabled={room.readOnly}
                onChange={(e) => room.setLanguage(activeNode.id, e.target.value)}
              >
                {LANGUAGE_CHOICES.map((lang) => (
                  <option key={lang} value={lang}>
                    {languageLabel(lang)}
                  </option>
                ))}
              </select>
            </label>
            <span className="statusbar-divider" />
          </>
        )}
        <span>{room.readOnly ? 'Read only' : 'Editing'}</span>
      </div>
    </footer>
  );
}

// ─── Activity rail icon ───────────────────────────────────────────────────────

type PanelId = 'files' | 'search' | 'rooms' | 'settings';

function RailButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' is-active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

// ─── Topbar ───────────────────────────────────────────────────────────────────

function Topbar({
  roomName,
  role,
  onShare,
  onRun,
  canRun,
  running,
  chatOpen,
  unreadMessages,
  onToggleChat,
  onRename,
  onLeave,
}: {
  roomName: string;
  role: string;
  onShare: () => void;
  onRun?: () => void;
  canRun: boolean;
  running: boolean;
  chatOpen: boolean;
  unreadMessages: number;
  onToggleChat: () => void;
  onRename: () => void;
  onLeave: () => void;
}) {
  const room = useRoom();
  const { user, guest } = useSession();
  const identity = user ?? guest;

  return (
    <header className="topbar">
      {/* Left: brand + room name */}
      <div className="topbar-left">
        <Brand />
        <span className="topbar-sep" />
        {role === 'OWNER' ? (
          <button type="button" className="topbar-room-name topbar-room-rename" title="Rename room" onClick={onRename}>
            {roomName}
          </button>
        ) : (
          <span className="topbar-room-name" title={roomName}>{roomName}</span>
        )}
      </div>

      {/* Center: clean spacing */}
      <div className="topbar-center" />

      {/* Right: Run button + avatars + share */}
      <div className="topbar-right">
        {onRun && canRun && (
          <button
            type="button"
            className="topbar-run-btn"
            onClick={onRun}
            title={running ? 'Program is running' : 'Run current file (Ctrl+Enter)'}
            disabled={running}
          >
            <Icon name={running ? 'refresh' : 'play'} size={14} className={running ? 'spin' : undefined} />
            <span>{running ? 'Running' : 'Run'}</span>
            <kbd>⌘↵</kbd>
          </button>
        )}
        <AvatarStack people={room.people} limit={4} />
        <button
          type="button"
          className={`topbar-chat-btn${chatOpen ? ' is-active' : ''}`}
          onClick={onToggleChat}
          title="Toggle room chat (Alt+Shift+C)"
          aria-label={unreadMessages > 0 ? `Open chat, ${unreadMessages} unread messages` : 'Toggle room chat'}
          aria-pressed={chatOpen}
        >
          <Icon name="chat" size={16} />
          <span>Chat</span>
          {unreadMessages > 0 && <b>{unreadMessages > 99 ? '99+' : unreadMessages}</b>}
        </button>
        {role === 'OWNER' && (
          <button type="button" className="topbar-share-btn" onClick={onShare}>
            <Icon name="share" size={14} />
            Share
          </button>
        )}
        {role !== 'OWNER' && (
          <button type="button" className="topbar-leave-btn" onClick={onLeave} title="Leave room">
            <Icon name="logout" size={14} />
            <span>Leave</span>
          </button>
        )}
        {identity && (
          <Avatar
            name={identity.name}
            color={user?.color ?? room.people.find((p) => p.isYou)?.color ?? '#7c6fff'}
            size={28}
            ring
          />
        )}
      </div>
    </header>
  );
}

// ─── Workspace shell ──────────────────────────────────────────────────────────

function WorkspaceInner({ roomId, detail }: { roomId: string; detail: RoomDetail }) {
  const [panel, setPanel] = useLocalSetting<PanelId>('panel', 'files');
  const [sidebarWidth, setSidebarWidth] = useLocalSetting('sidebarWidth', 240);
  const [sidebarOpen, setSidebarOpen] = useLocalSetting('sidebarOpen', true);
  const [chatOpen, setChatOpen] = useLocalSetting('chatOpen', false);
  const [showShare, setShowShare] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [roomName, setRoomName] = useState(detail.room.name);
  const { user, guest, endGuestSession } = useSession();
  const room = useRoom();
  const activeNode = useActiveNode();
  const showToast = useToast();

  // Execution runner state
  const [outputCollapsed, setOutputCollapsed] = useLocalSetting('outputCollapsed', true);
  const [outputLogs, setOutputLogs] = useState<LogEntry[]>([]);
  const [outputProblems, setOutputProblems] = useState<ProblemEntry[]>([]);
  const [outputStdin, setOutputStdin] = useState('');
  const [outputDuration, setOutputDuration] = useState('Ready');
  const [isRunning, setIsRunning] = useState(false);
  const [runVersion, setRunVersion] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [socketPeople, setSocketPeople] = useState<Person[]>([]);
  const chatOpenRef = useRef(chatOpen);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setUnreadMessages(0);
  }, [chatOpen]);

  const toggleChat = useCallback(() => {
    setChatOpen(!chatOpenRef.current);
  }, [setChatOpen]);

  const noteIncomingChat = useCallback(() => {
    if (!chatOpenRef.current) setUnreadMessages((count) => count + 1);
  }, []);

  const updateSocketPeople = useCallback((people: LiveRoomPerson[]) => {
    setSocketPeople(
      people.map((person, index) => ({
        ...person,
        clientId: -(index + 1),
        isYou: person.id === detail.identity.id,
      })),
    );
  }, [detail.identity.id]);

  const activePeople = socketPeople.length > 0 ? socketPeople : room.people;

  const leaveRoom = useCallback(async () => {
    if (!window.confirm('Leave this room?')) return;
    try {
      if (detail.guest) {
        endGuestSession();
        showToast('Left room.');
        navigate({ name: 'landing' });
      } else {
        await api(`/api/rooms/${roomId}/leave`, { method: 'POST' });
        showToast('Left room.');
        navigate({ name: 'rooms' });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not leave room.', 'error');
    }
  }, [detail.guest, endGuestSession, roomId, showToast]);

  const handleRun = useCallback(async () => {
    if (isRunning) return;
    if (room.readOnly || !activeNode || activeNode.type !== 'FILE') {
      showToast('Open a Python, JavaScript, TypeScript, C, C++, or Java source file to run it.', 'error');
      return;
    }

    const byId = new Map(room.tree.map((node) => [node.id, node]));
    const pathFor = (nodeId: string): string | null => {
      const segments: string[] = [];
      const seen = new Set<string>();
      let current = byId.get(nodeId);

      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        segments.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }

      return current ? null : segments.length > 0 ? segments.join('/') : null;
    };

    const files = room.tree
      .filter((node) => node.type === 'FILE')
      .map((node) => {
        const open = room.documentFor(node.id);
        const content = open?.doc.getText(CONTENT_TEXT_KEY).toString();
        const path = pathFor(node.id);
        return path
          ? { id: node.id, path, language: node.language, ...(content === undefined ? {} : { content }) }
          : null;
      })
      .filter((file): file is { id: string; path: string; language: string | null; content?: string } => file !== null);

    const entryPath = pathFor(activeNode.id);
    if (!entryPath) {
      showToast('This file cannot be located in the project tree.', 'error');
      return;
    }

    setOutputCollapsed(false);
    setRunVersion((version) => version + 1);
    setIsRunning(true);
    setOutputLogs([{ type: 'system', text: `Running ${entryPath} in the isolated code runner…` }]);
    setOutputProblems([]);
    setOutputDuration('Starting…');

    try {
      const { result } = await api<{
        result: {
          status: { id: number; description: string };
          stdout: string | null;
          stderr: string | null;
          compileOutput: string | null;
          message: string | null;
          time: string | null;
          memory: number | null;
        };
      }>(`/api/rooms/${roomId}/run`, {
        method: 'POST',
        body: { entryFileId: activeNode.id, stdin: outputStdin, files },
      });

      const failureOutput = [result.compileOutput, result.stderr, result.message]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      const lines: LogEntry[] = [
        {
          type: result.status.id === 3 ? 'info' : 'error',
          text: `${result.status.id === 3 ? '✓' : '×'} ${result.status.description}`,
        },
      ];
      if (result.stdout) lines.push({ type: 'log', text: result.stdout.trimEnd() });
      if (failureOutput) lines.push({ type: 'error', text: failureOutput.trimEnd() });
      if (!result.stdout && !failureOutput && result.status.id === 3) {
        lines.push({ type: 'system', text: 'Program finished without output.' });
      }
      setOutputLogs(lines);

      const problems: ProblemEntry[] = [];
      for (const match of failureOutput.matchAll(/(?:^|\n)([^:\n]+\.java):(\d+):/g)) {
        problems.push({ file: match[1], line: Number(match[2]), message: 'Java compilation error' });
      }
      for (const match of failureOutput.matchAll(/File "([^"]+)", line (\d+)/g)) {
        problems.push({ file: match[1], line: Number(match[2]), message: 'Python execution error' });
      }
      setOutputProblems(problems);

      const memory = result.memory === null ? '' : ` · ${(result.memory / 1024).toFixed(1)} MB`;
      setOutputDuration(result.time ? `${result.time}s${memory}` : result.status.description);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Code execution failed.';
      setOutputLogs([{ type: 'error', text: message }]);
      setOutputDuration('Run failed');
      showToast(message, 'error');
    } finally {
      setIsRunning(false);
    }
  }, [activeNode, isRunning, outputStdin, room, roomId, setOutputCollapsed, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        toggleChat();
        return;
      }
      if (room.readOnly) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRun, room.readOnly, toggleChat]);

  const togglePanel = (p: PanelId) => {
    if (panel === p && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      setPanel(p);
      setSidebarOpen(true);
    }
  };

  return (
    <div className="app-shell">
      {/* Top bar */}
      <Topbar
        roomName={roomName}
        role={detail.role}
        onShare={() => setShowShare(true)}
        onRun={handleRun}
        canRun={!room.readOnly}
        running={isRunning}
        chatOpen={chatOpen}
        unreadMessages={unreadMessages}
        onToggleChat={toggleChat}
        onRename={() => setShowRename(true)}
        onLeave={() => void leaveRoom()}
      />

      <div className="ide">
        {/* Activity rail */}
        <nav className="rail" aria-label="Activity bar">
          <div className="rail-top">
            <RailButton
              icon="files"
              label="Explorer"
              active={panel === 'files' && sidebarOpen}
              onClick={() => togglePanel('files')}
            />
            <RailButton
              icon="search"
              label="Search"
              active={panel === 'search' && sidebarOpen}
              onClick={() => togglePanel('search')}
            />
            <RailButton
              icon="rooms"
              label="Rooms"
              active={panel === 'rooms' && sidebarOpen}
              onClick={() => togglePanel('rooms')}
            />
          </div>
          <div className="rail-bottom">
            <RailButton
              icon="settings"
              label="Settings & Profile"
              active={panel === 'settings' && sidebarOpen}
              onClick={() => togglePanel('settings')}
            />
            {(user ?? guest) && (
              <button
                type="button"
                className="rail-avatar-btn"
                title={user ? `Signed in as ${user.name}` : `Guest: ${guest?.name}`}
                onClick={() => togglePanel('settings')}
              >
                <Avatar
                  name={(user ?? guest)!.name}
                  color={user?.color ?? '#7c6fff'}
                  size={28}
                />
              </button>
            )}
          </div>
        </nav>

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar" style={{ width: sidebarWidth }}>
            {panel === 'files' && <FilesPanel roomName={roomName} />}
            {panel === 'search' && <SearchPanel />}
            {panel === 'rooms' && (
              <RoomsPanel
                currentRoomId={roomId}
                onSelectRoom={() => setPanel('files')}
              />
            )}
            {panel === 'settings' && <SettingsPanel />}
            {panel === 'files' && <CollaboratorList people={activePeople} />}
          </aside>
        )}

        {/* Resize handle */}
        {sidebarOpen && (
          <Resizer
            width={sidebarWidth}
            min={180}
            max={480}
            onResize={setSidebarWidth}
            onToggle={() => setSidebarOpen(false)}
          />
        )}

        {/* Editor area with Output Drawer */}
        <EditorArea
          outputDrawer={
            <OutputPanel
              collapsed={outputCollapsed}
              onToggleCollapsed={() => setOutputCollapsed(!outputCollapsed)}
              logs={outputLogs}
              problems={outputProblems}
              stdin={outputStdin}
              onStdinChange={setOutputStdin}
              onClear={() => {
                setOutputLogs([]);
                setOutputProblems([]);
                setOutputDuration('Cleared');
              }}
              duration={outputDuration}
              running={isRunning}
              focusOutput={runVersion}
            />
          }
        />

        <ChatPanel
          roomId={roomId}
          selfId={detail.identity.id}
          activeFileId={room.activeFileId}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onIncomingMessage={noteIncomingChat}
          onPresenceChange={updateSocketPeople}
          onRoomRenamed={setRoomName}
        />
      </div>

      {showShare && (
        <ShareDialog roomId={roomId} onClose={() => setShowShare(false)} />
      )}
      {showRename && (
        <RenameRoomDialog
          roomId={roomId}
          currentName={roomName}
          onClose={() => setShowRename(false)}
          onRenamed={setRoomName}
        />
      )}
    </div>
  );
}

function WorkspaceShell({ roomId, detail }: { roomId: string; detail: RoomDetail }) {
  const { guest } = useSession();

  useEffect(() => {
    localStorage.setItem('codetogether.lastRoomId', roomId);
  }, [roomId]);

  const authToken = guest?.token ?? null;

  return (
    <RoomProvider
      key={roomId}
      roomId={roomId}
      role={detail.role}
      token={authToken}
      identity={detail.identity}
      guest={detail.guest}
    >
      <WorkspaceInner roomId={roomId} detail={detail} />
    </RoomProvider>
  );
}

// ─── Room loader ──────────────────────────────────────────────────────────────

function RoomPage({ roomId }: { roomId: string }) {
  const { user, guest, loading: sessionLoading } = useSession();
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;

    // Not signed in and not a guest for this room → go to landing
    if (!user && (!guest || guest.roomId !== roomId)) {
      navigate({ name: 'landing' }, { replace: true });
      return;
    }

    api<RoomDetail>(`/api/rooms/${roomId}`)
      .then(setDetail)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Could not load room.';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [roomId, user, guest, sessionLoading]);

  if (sessionLoading || loading) {
    return (
      <div className="loading">
        <Icon name="refresh" size={22} className="spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="landing">
        <div className="landing-card">
          <Brand />
          <p className="auth-error" style={{ marginTop: 24 }}>{error}</p>
          <button
            type="button"
            className="button-quiet button-full"
            style={{ marginTop: 12 }}
            onClick={() => navigate({ name: 'rooms' })}
          >
            Back to rooms
          </button>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return <WorkspaceShell roomId={roomId} detail={detail} />;
}

// ─── Root router ──────────────────────────────────────────────────────────────

function Router() {
  const route = useRoute();
  const { loading, user } = useSession();
  const enteringRef = useRef(false);

  useEffect(() => {
    if (loading || !user) return;
    if (route.name === 'room' || route.name === 'join') return;
    if (enteringRef.current) return;
    enteringRef.current = true;
    void enterWorkspace().finally(() => {
      enteringRef.current = false;
    });
  }, [loading, user, route.name]);

  if (loading) {
    return (
      <div className="loading">
        <Icon name="refresh" size={22} className="spin" />
      </div>
    );
  }

  switch (route.name) {
    case 'join':
      return <JoinPage token={route.token} />;
    case 'room':
      return <RoomPage roomId={route.roomId} />;
    case 'rooms':
      if (user) {
        return (
          <div className="loading">
            <Icon name="refresh" size={22} className="spin" />
          </div>
        );
      }
      return <RoomsPage />;
    default:
      if (user) {
        return (
          <div className="loading">
            <Icon name="refresh" size={22} className="spin" />
          </div>
        );
      }
      return <LandingPage />;
  }
}

export default function App() {
  return (
    <PreferencesProvider>
      <SessionProvider>
        <ToastProvider>
          <Router />
        </ToastProvider>
      </SessionProvider>
    </PreferencesProvider>
  );
}
