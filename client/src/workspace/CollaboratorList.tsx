import { useMemo } from 'react';
import { ROLE_LABEL, type Person } from '../types';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { useRoom } from './RoomProvider';
import { pathOf } from './tree';
import { sortCollaborators } from './collaboratorSort';

/**
 * Who is in the room right now, straight from Yjs awareness or live presence.
 * Clicking someone jumps to the file they are in; Follow keeps this view tracking them.
 *
 * Ordered deterministically:
 * 1. Owner(s)
 * 2. Editors (alphabetical by name)
 * 3. Viewers (alphabetical by name)
 */
export function CollaboratorList({ people: suppliedPeople }: { people?: Person[] }) {
  const room = useRoom();
  const rawPeople = suppliedPeople ?? room.people;

  const people = useMemo(() => sortCollaborators(rawPeople), [rawPeople]);

  return (
    <section className="collaborators">
      <header>
        <strong>Active users</strong>
        <span className="pill">{people.length}</span>
      </header>

      {people.length === 0 ? (
        <p className="panel-note">
          {room.connection === 'connecting' ? 'Connecting…' : 'No collaborators online'}
        </p>
      ) : (
        <div className="collaborators-list">
          {people.map((person) => {
            const where = person.fileId ? pathOf(room.tree, person.fileId) : '';
            const following = room.followingId === person.id;

            return (
              <div key={person.id} className={`collaborator${following ? ' is-following' : ''}`}>
                <Avatar name={person.name} color={person.color} photoUrl={person.avatarUrl} size={24} />

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
                  <span className="collaborator-sub">
                    <span className="collaborator-location" title={where || 'No file open'}>
                      {where || 'No file open'}
                    </span>
                    <span className="collaborator-dot">·</span>
                    <span className={`collaborator-role role-${person.role.toLowerCase()}`}>
                      {ROLE_LABEL[person.role]?.toLowerCase() ?? 'member'}
                    </span>
                    {person.guest && (
                      <>
                        <span className="collaborator-dot">·</span>
                        <span className="collaborator-guest">guest</span>
                      </>
                    )}
                  </span>
                </button>

                {(person.isYou || person.role === 'OWNER') && (
                  <em className="role-chip">{ROLE_LABEL[person.role]}</em>
                )}
                {!person.isYou && (
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
        </div>
      )}
    </section>
  );
}
