import { Icon } from '../ui/Icon';
import { useRoom } from './RoomProvider';
import { badgeFor } from './language';

export function EditorTabs() {
  const room = useRoom();

  if (room.openFileIds.length === 0) return null;

  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {room.openFileIds.map((fileId) => {
        const node = room.tree.find((entry) => entry.id === fileId);
        const deleted = room.deletedFileIds.includes(fileId);
        const name = node?.name ?? 'Deleted file';
        const badge = badgeFor(name);
        const active = room.activeFileId === fileId;

        return (
          <div
            key={fileId}
            className={`tab${active ? ' is-active' : ''}${deleted ? ' is-deleted' : ''}`}
            role="tab"
            aria-selected={active}
          >
            <button type="button" className="tab-label" onClick={() => room.focusFile(fileId)}>
              <span className={`file-badge tint-${badge.tint}`}>{badge.badge}</span>
              <span className="tab-name">{name}</span>
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${name}`}
              onClick={() => room.closeFile(fileId)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
