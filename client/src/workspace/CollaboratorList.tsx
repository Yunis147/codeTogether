import { ROLE_LABEL } from '../types';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { useRoom } from './RoomProvider';
import { pathOf } from './tree';

/**
 * Who is in the room right now, straight from Yjs awareness. Clicking someone
 * jumps to the file they are in; Follow keeps this view tracking them.
 */
export function CollaboratorList() {
  const room = useRoom();

  return (
    <section className="collaborators">
      <header>
        <strong>Active collaborators</strong>
        <span className="pill">{room.people.length}</span>
      </header>

      {room.people.length === 0 && (
        <p className="panel-note">
          {room.connection === 'connecting' ? 'Connecting…' : 'No collaborators online'}
        </p>
      )}

      {room.people.map((person) => {
        const where = person.fileId ? pathOf(room.tree, person.fileId) : '';
        const following = room.followingId === person.id;

        return (
          <div key={person.id} className={`collaborator${following ? ' is-following' : ''}`}>
            <Avatar name={person.name} color={person.color} size={24} />

            <button
              type="button"
              className="collaborator-main"
              disabled={!person.fileId}
              title={person.fileId ? `Jump to ${where}` : 'Not in a file'}
              onClick={() => {
                if (person.fileId) room.openFile(person.fileId);
              }}
            >
              <b>
                {person.name}
                {person.isYou && <small> (you)</small>}
              </b>
              <span>
                {where || 'No file open'}
                {person.guest ? ' · guest' : ''}
              </span>
            </button>

            {person.isYou ? (
              <em className="role-chip">{ROLE_LABEL[person.role]}</em>
            ) : (
              <button
                type="button"
                className={`follow-button${following ? ' is-on' : ''}`}
                onClick={() => room.setFollowingId(following ? null : person.id)}
                title={following ? `Stop following ${person.name}` : `Follow ${person.name}`}
              >
                <Icon name="follow" size={11} />
                {following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
