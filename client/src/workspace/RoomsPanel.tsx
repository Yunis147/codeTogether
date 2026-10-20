import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../hooks/useRoute';
import { useSession } from '../session/SessionProvider';
import { ROLE_LABEL, type RoomSummary } from '../types';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';

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
  onSelectRoom,
}: {
  currentRoomId: string;
  onSelectRoom?: () => void;
}) {
  const { user } = useSession();
  const { rooms, loading, reload } = useRooms(Boolean(user));
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

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

  const deleteRoom = async (roomId: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (!window.confirm('Delete this room? This cannot be undone.')) return;
    try {
      await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
      toast('Room deleted.');
      await reload();
      if (roomId === currentRoomId) {
        const remaining = rooms.owned.filter((r) => r.id !== roomId);
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
    }
  };

  const leaveRoom = async (roomId: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (!window.confirm('Leave this room?')) return;
    try {
      await api(`/api/rooms/${roomId}/leave`, { method: 'POST' });
      toast('Left room.');
      await reload();
      if (roomId === currentRoomId) {
        const remaining = rooms.owned[0] ?? rooms.shared.filter((r) => r.id !== roomId)[0];
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
              <button
                type="button"
                className="icon-button room-action is-danger"
                title="Delete room"
                onClick={(e) => void deleteRoom(room.id, e)}
              >
                <Icon name="trash" size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-button room-action"
                title="Leave room"
                onClick={(e) => void leaveRoom(room.id, e)}
              >
                <Icon name="logout" size={13} />
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
        <div className="panel-pad">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. algo-playground"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
              else if (event.key === 'Escape') setCreating(false);
            }}
          />
          <div className="button-row">
            <button type="button" className="button-primary" onClick={() => void create()}>
              Create room
            </button>
            <button type="button" className="button-quiet" onClick={() => setCreating(false)}>
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
    </div>
  );
}
