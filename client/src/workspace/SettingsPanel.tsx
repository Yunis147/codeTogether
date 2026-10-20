import { useState } from 'react';
import { apiBlob } from '../api';
import { navigate } from '../hooks/useRoute';
import { FONT_SIZES, usePreferences } from '../settings/PreferencesProvider';
import { useSession } from '../session/SessionProvider';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { useToast } from '../ui/Toast';
import { useRoom } from './RoomProvider';

export function SettingsPanel() {
  const { theme, setTheme, fontSize, setFontSize } = usePreferences();
  const { user, guest, signOut, renameSelf } = useSession();
  const room = useRoom();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? guest?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [exporting, setExporting] = useState(false);

  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const { blob, filename } = await apiBlob(`/api/rooms/${room.roomId}/export`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast('Project downloaded.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not export the project.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const saveName = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!user || trimmed.length < 2 || trimmed === user.name) return;

    setSavingName(true);
    try {
      await renameSelf(trimmed);
      toast('Name updated.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update your name.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Preferences</p>
          <h2>Settings</h2>
        </div>
      </header>

      <div className="panel-scroll panel-pad">
        <section className="setting-group">
          <p className="eyebrow">Appearance</p>

          <div className="segmented" role="group" aria-label="Theme">
            <button
              type="button"
              className={theme === 'dark' ? 'is-on' : ''}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size={14} /> Dark
            </button>
            <button
              type="button"
              className={theme === 'light' ? 'is-on' : ''}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size={14} /> Light
            </button>
          </div>

          <label className="setting-row" htmlFor="font-size">
            <span>Editor font size</span>
            <select
              id="font-size"
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="setting-group">
          <p className="eyebrow">Project</p>
          <button
            type="button"
            className="button-quiet button-wide"
            onClick={() => void download()}
            disabled={exporting || Boolean(guest)}
            title={guest ? 'Sign in to download this project' : 'Download as a zip'}
          >
            <Icon name="download" size={15} />
            {exporting ? 'Preparing…' : 'Download project as zip'}
          </button>
          {guest && <p className="panel-note">Downloading needs an account.</p>}
        </section>

        <section className="setting-group">
          <p className="eyebrow">You</p>

          {user ? (
            <>
              <div className="setting-identity">
                <Avatar name={user.name} color={user.color} size={34} />
                <div>
                  <b>{user.name}</b>
                  <small>{user.email}</small>
                </div>
              </div>

              <label className="setting-row setting-stacked" htmlFor="display-name">
                <span>Display name</span>
                <div className="button-row">
                  <input
                    id="display-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveName();
                    }}
                  />
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => void saveName()}
                    disabled={savingName || name.trim() === user.name || name.trim().length < 2}
                  >
                    Save
                  </button>
                </div>
              </label>

              <button
                type="button"
                className="button-quiet button-wide"
                onClick={async () => {
                  await signOut();
                  navigate({ name: 'landing' });
                }}
              >
                <Icon name="logout" size={15} /> Sign out
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                You are in this room as <b>{guest?.name}</b>, a guest.
              </p>
              <button
                type="button"
                className="button-primary button-wide"
                onClick={() => navigate({ name: 'landing' })}
              >
                Create an account
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
