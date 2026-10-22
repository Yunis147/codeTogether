import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { SearchResult } from '../types';
import { Icon } from '../ui/Icon';
import { useRoom } from './RoomProvider';
import { badgeFor } from './language';
import { pathOf } from './tree';

export function SearchPanel() {
  const room = useRoom();
  const roomRef = useRef(room);
  roomRef.current = room;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults([]);
      setState('idle');
      return;
    }

    setState('searching');
    const timer = window.setTimeout(async () => {
      const currentRoom = roomRef.current;
      let serverResults: SearchResult[] = [];
      try {
        const result = await api<{ results: SearchResult[] }>(
          `/api/rooms/${currentRoom.roomId}/search?q=${encodeURIComponent(trimmed)}`,
        );
        serverResults = result.results;
      } catch {
        // Fallback to client-side search if server request fails
      }

      // Merge with live tree/active documents
      const activeFileIds = new Set(currentRoom.tree.filter((n) => n.type === 'FILE').map((n) => n.id));
      const mergedMap = new Map<string, SearchResult>();
      for (const res of serverResults) {
        if (activeFileIds.has(res.fileId)) {
          mergedMap.set(res.fileId, res);
        }
      }

      const qLower = trimmed.toLowerCase();
      for (const node of currentRoom.tree) {
        if (node.type !== 'FILE') continue;
        if (mergedMap.has(node.id)) continue;

        // Check if name matches
        if (node.name.toLowerCase().includes(qLower)) {
          mergedMap.set(node.id, {
            fileId: node.id,
            name: node.name,
            matches: [{ line: 1, column: 1, text: `File: ${node.name}` }],
          });
        }
      }

      // Check open documents live in memory (authoritative for live edits)
      for (const fileId of currentRoom.openFileIds) {
        if (!activeFileIds.has(fileId)) {
          mergedMap.delete(fileId);
          continue;
        }
        const doc = currentRoom.documentFor(fileId);
        if (!doc) continue;

        // Discard stale debounced server results for this open file
        mergedMap.delete(fileId);

        const text = doc.model.getValue();
        const lines = text.split('\n');
        const matches: { line: number; column: number; text: string }[] = [];
        for (let i = 0; i < lines.length; i += 1) {
          const col = lines[i].toLowerCase().indexOf(qLower);
          if (col !== -1) {
            matches.push({ line: i + 1, column: col + 1, text: lines[i].slice(0, 400) });
            if (matches.length >= 20) break;
          }
        }
        const node = currentRoom.tree.find((n) => n.id === fileId);
        if (matches.length > 0) {
          mergedMap.set(fileId, {
            fileId,
            name: node?.name ?? 'Untitled',
            matches,
          });
        } else if (node && node.name.toLowerCase().includes(qLower)) {
          mergedMap.set(fileId, {
            fileId,
            name: node.name,
            matches: [{ line: 1, column: 1, text: `File: ${node.name}` }],
          });
        }
      }

      setResults(Array.from(mergedMap.values()));
      setState('done');
    }, 200);

    return () => window.clearTimeout(timer);
  }, [query, room.roomId]);

  const total = useMemo(
    () => results.reduce((sum, file) => sum + file.matches.length, 0),
    [results],
  );

  return (
    <div className="panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Project</p>
          <h2>Search</h2>
        </div>
      </header>

      <div className="panel-pad">
        <label className="field-icon">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find in all files"
            aria-label="Search all files"
            autoFocus
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </label>

        {state === 'done' && (
          <p className="search-summary">
            {total === 0
              ? 'No matches.'
              : `${total} match${total === 1 ? '' : 'es'} in ${results.length} file${
                  results.length === 1 ? '' : 's'
                }`}
          </p>
        )}
        {state === 'searching' && <p className="search-summary">Searching…</p>}
        {state === 'error' && <p className="search-summary is-error">Search failed. Try again.</p>}
        {state === 'idle' && query.trim().length > 0 && (
          <p className="search-summary">Keep typing — two characters minimum.</p>
        )}
      </div>

      <div className="search-results">
        {results.map((file) => {
          const badge = badgeFor(file.name);
          const path = pathOf(room.tree, file.fileId) || file.name;

          return (
            <section key={file.fileId} className="search-file">
              <header>
                <span className={`file-badge tint-${badge.tint}`}>{badge.badge}</span>
                <strong>{file.name}</strong>
                <span className="search-count">{file.matches.length}</span>
                <small title={path}>{path}</small>
              </header>

              {file.matches.map((match) => (
                <button
                  key={`${match.line}:${match.column}`}
                  type="button"
                  className="search-hit"
                  onClick={() => room.revealMatch(file.fileId, match.line, match.column)}
                >
                  <span className="search-line">{match.line}</span>
                  <Highlighted text={match.text} query={query.trim()} />
                </button>
              ))}
            </section>
          );
        })}
      </div>

      {state === 'done' && results.length > 0 && (
        <p className="panel-note">Results come from the last save, a moment behind live typing.</p>
      )}
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <span className="search-text">{text.trim()}</span>;

  // Keep a little context before the match so long lines stay readable.
  const start = Math.max(0, index - 24);

  return (
    <span className="search-text">
      {start > 0 && '…'}
      {text.slice(start, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length, index + query.length + 80)}
    </span>
  );
}
