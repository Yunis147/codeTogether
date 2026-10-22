import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { navigate } from '../hooks/useRoute';
import { useSession } from '../session/SessionProvider';
import { ROLE_LABEL, type RoomSummary } from '../types';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { RenameRoomDialog } from './RenameRoomDialog';

type RoomsResponse = { owned: RoomSummary[]; shared: RoomSummary[] };

export function useRooms(enabled: boolean = true) {
  const [rooms, setRooms] = useState<RoomsResponse>({ owned: [], shared: [] });
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    try {
      setRooms(await api<RoomsResponse>('/api/rooms'));
    } catch {
      setRooms({ owned: [], shared: [] });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      void reload();
    } else {
      setLoading(false);
    }
  }, [reload, enabled]);

  return { rooms, loading, reload };
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;

  return new Date(iso).toLocaleDateString();
}

export function RoomsPanel({
  currentRoomId,
  currentRoomName,
  onSelectRoom,
  onRenameCurrentRoom,
}: {
  currentRoomId: string;
  currentRoomName?: string;
  onSelectRoom?: () => void;
  onRenameCurrentRoom?: (name: string) => void;
}) {
  const { user } = useSession();
  const { rooms: fetchedRooms, loading, reload } = useRooms(Boolean(user));
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [renamingRoom, setRenamingRoom] = useState<{ id: string; name: string } | null>(null);
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<{ id: string; name: string } | null>(null);
  const [pendingLeaveRoom, setPendingLeaveRoom] = useState<{ id: string; name: string } | null>(null);
  const [deletingRoom, setDeletingRoom] = useState(false);
  const [leavingRoom, setLeavingRoom] = useState(false);

  // Patch the fetched room list with the live room name so a rename in the
  // topbar is immediately reflected here without a network round-trip.
  const rooms = useMemo((): RoomsResponse => {
    if (!currentRoomName) return fetchedRooms;
    return {
      owned: fetchedRooms.owned.map((room) =>
        room.id === currentRoomId ? { ...room, name: currentRoomName } : room,
      ),
      shared: fetchedRooms.shared.map((room) =>
        room.id === currentRoomId ? { ...room, name: currentRoomName } : room,
      ),
    };
  }, [currentRoomId, currentRoomName, fetchedRooms]);

  useEffect(() => {
    if (user) void reload();
  }, [currentRoomName, user, reload]);

  const handleOpenRoom = (targetRoomId: string) => {
    localStorage.setItem('codetogether.lastRoomId', targetRoomId);
    navigate({ name: 'room', roomId: targetRoomId });
    onSelectRoom?.();
  };

  // Guests get the panel too, as a nudge rather than a locked door.
  if (!user) {
    return (
      <div className="panel">
        <header className="panel-head">
          <div>
            <p className="eyebrow">Your work</p>
            <h2>Rooms</h2>
          </div>
        </header>
        <div className="panel-pad panel-prompt">
          <Icon name="rooms" size={22} />
          <h3>Sign up to create and save rooms</h3>
          <p className="muted">
            You can keep editing as a guest. An account keeps a list of every room you join and
            lets you download projects.
          </p>
          <button
            type="button"
            className="button-primary"
            onClick={() => navigate({ name: 'landing' })}
          >
            Create an account
          </button>
          <p className="panel-note">You will come back to this room afterwards.</p>
        </div>
      </div>
    );
  }

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast('Room names need at least 2 characters.', 'error');
      return;
    }

    try {
      const result = await api<{ room: RoomSummary }>('/api/rooms', {
        method: 'POST',
        body: { name: trimmed },
      });
      setName('');
      setCreating(false);
      await reload();
      handleOpenRoom(result.room.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the room.', 'error');
    }
  };

  const confirmDeleteRoom = async (): Promise<void> => {
    if (!pendingDeleteRoom) return;
    const targetId = pendingDeleteRoom.id;
    setDeletingRoom(true);
    try {
      await api(`/api/rooms/${targetId}`, { method: 'DELETE' });
      toast('Room deleted.');
      setPendingDeleteRoom(null);
      await reload();
      if (targetId === currentRoomId) {
        const remaining = rooms.owned.filter((r) => r.id !== targetId);
        if (remaining.length > 0) {
          navigate({ name: 'room', roomId: remaining[0].id });
        } else {
          const res = await api<{ room: RoomSummary }>('/api/rooms', {
            method: 'POST',
            body: { name: 'workspace' },
          });
          navigate({ name: 'room', roomId: res.room.id });
        }
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete room.', 'error');
    } finally {
      setDeletingRoom(false);
    }
  };

  const confirmLeaveRoom = async (): Promise<void> => {
    if (!pendingLeaveRoom) return;
    const targetId = pendingLeaveRoom.id;
    setLeavingRoom(true);
    try {
      await api(`/api/rooms/${targetId}/leave`, { method: 'POST' });
      toast('Left room.');
      setPendingLeaveRoom(null);
      await reload();
      if (targetId === currentRoomId) {
        const remaining = rooms.owned[0] ?? rooms.shared.filter((r) => r.id !== targetId)[0];
        if (remaining) {
          navigate({ name: 'room', roomId: remaining.id });
        } else {
          const res = await api<{ room: RoomSummary }>('/api/rooms', {
            method: 'POST',
            body: { name: 'workspace' },
          });
          navigate({ name: 'room', roomId: res.room.id });
        }
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not leave room.', 'error');
    } finally {
      setLeavingRoom(false);
    }
  };

  const section = (title: string, list: RoomSummary[], emptyText: string) => (
    <section className="room-section">
      <p className="eyebrow">{title}</p>
      {list.length === 0 ? (
        <p className="panel-note">{emptyText}</p>
      ) : (
        list.map((room) => (
          <div
            key={room.id}
            role="button"
            tabIndex={0}
            className={`room-row${room.id === currentRoomId ? ' is-active' : ''}`}
            onClick={() => handleOpenRoom(room.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleOpenRoom(room.id);
            }}
          >
            <span className="room-row-main">
              <strong>{room.name}</strong>
              <small>
                {ROLE_LABEL[room.role]} · {relativeTime(room.updatedAt)}
              </small>
            </span>
            {room.id === currentRoomId && <span className="room-row-dot" aria-label="Open" />}
            {room.role === 'OWNER' ? (
              <div className="room-row-actions" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <button
                  type="button"
                  className="icon-button room-action"
                  title="Rename room"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingRoom({ id: room.id, name: room.name });
                  }}
                >
                  <Icon name="pencil" size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button room-action is-danger"
                  title="Delete room"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDeleteRoom({ id: room.id, name: room.name });
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="icon-button room-action"
                title="Leave room"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingLeaveRoom({ id: room.id, name: room.name });
                }}
              >
                <Icon name="logout" size={16} />
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Your work</p>
          <h2>Rooms</h2>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-button"
            title="New room"
            onClick={() => setCreating((current) => !current)}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </header>

      {creating && (
        <div className="room-create-card">
          <span className="room-create-title">Create new room</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Room name, e.g. algo-playground"
            autoFocus
            maxLength={60}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
              else if (event.key === 'Escape') setCreating(false);
            }}
          />
          <div className="room-create-actions">
            <button
              type="button"
              className="button-primary button-sm"
              onClick={() => void create()}
            >
              Create
            </button>
            <button
              type="button"
              className="button-quiet button-sm"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="panel-scroll">
        {loading ? (
          <p className="panel-note">Loading…</p>
        ) : (
          <>
            {section('My rooms', rooms.owned, 'You do not own any rooms yet.')}
            {section('Shared with me', rooms.shared, 'Rooms you join will appear here.')}
          </>
        )}
      </div>

      {renamingRoom && (
        <RenameRoomDialog
          roomId={renamingRoom.id}
          currentName={renamingRoom.name}
          onClose={() => setRenamingRoom(null)}
          onRenamed={(newName) => {
            if (renamingRoom.id === currentRoomId) {
              onRenameCurrentRoom?.(newName);
            }
            void reload();
          }}
        />
      )}

      {pendingDeleteRoom && (
        <Modal
          title="Delete room?"
          onClose={() => setPendingDeleteRoom(null)}
          width={400}
        >
          <div className="delete-confirm">
            <div className="delete-confirm-icon">
              <Icon name="trash" size={18} />
            </div>
            <div>
              <p className="delete-confirm-title">
                Delete <b>{pendingDeleteRoom.name}</b>?
              </p>
              <p className="muted">
                All files, chat messages, and settings in this room will be permanently destroyed. This cannot be undone.
              </p>
            </div>
            <div className="delete-confirm-actions">
              <button
                type="button"
                className="button-quiet"
                onClick={() => setPendingDeleteRoom(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={deletingRoom}
                onClick={() => void confirmDeleteRoom()}
              >
                {deletingRoom ? 'Deleting…' : 'Delete room'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingLeaveRoom && (
        <Modal
          title="Leave room?"
          onClose={() => setPendingLeaveRoom(null)}
          width={400}
        >
          <div className="delete-confirm">
            <div className="delete-confirm-icon">
              <Icon name="logout" size={18} />
            </div>
            <div>
              <p className="delete-confirm-title">
                Leave <b>{pendingLeaveRoom.name}</b>?
              </p>
              <p className="muted">
                You will be removed as a member. You will need an invite link to rejoin.
              </p>
            </div>
            <div className="delete-confirm-actions">
              <button
                type="button"
                className="button-quiet"
                onClick={() => setPendingLeaveRoom(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={leavingRoom}
                onClick={() => void confirmLeaveRoom()}
              >
                {leavingRoom ? 'Leaving…' : 'Leave room'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
