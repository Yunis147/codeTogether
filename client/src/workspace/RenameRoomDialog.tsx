import { useState } from 'react';
import { api } from '../api';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

export function RenameRoomDialog({
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
      toast('Room renamed.');
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
        <label className="field-label" htmlFor="rename-room-input">Room name</label>
        <input
          id="rename-room-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          maxLength={60}
        />
        <div className="modal-actions">
          <button type="button" className="button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={saving}>
            {saving ? 'Renaming…' : 'Rename room'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
