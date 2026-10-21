import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';

export type LogEntry = {
  type: 'log' | 'info' | 'warn' | 'error' | 'system';
  text: string;
};

export type ProblemEntry = {
  file: string;
  line: number;
  message: string;
};

type OutputTab = 'output' | 'input' | 'problems';

export function OutputPanel({
  collapsed,
  onToggleCollapsed,
  logs,
  problems,
  stdin,
  onStdinChange,
  onClear,
  duration,
  running,
  focusOutput,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  logs: LogEntry[];
  problems: ProblemEntry[];
  stdin: string;
  onStdinChange: (value: string) => void;
  onClear: () => void;
  duration: string;
  running: boolean;
  /** Bumps when a run starts so the result is always visible. */
  focusOutput: number;
}) {
  const [tab, setTab] = useState<OutputTab>('output');

  useEffect(() => {
    if (focusOutput > 0) setTab('output');
  }, [focusOutput]);

  return (
    <section className={`output-drawer${collapsed ? ' is-collapsed' : ''}`}>
      <div className="output-drawer-head">
        <div className="output-tabs">
          <button
            type="button"
            className={`output-tab${tab === 'output' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('output');
              if (collapsed) onToggleCollapsed();
            }}
          >
            OUTPUT
          </button>
          <button
            type="button"
            className={`output-tab${tab === 'input' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('input');
              if (collapsed) onToggleCollapsed();
            }}
          >
            INPUT
          </button>
          <button
            type="button"
            className={`output-tab${tab === 'problems' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('problems');
              if (collapsed) onToggleCollapsed();
            }}
          >
            PROBLEMS
            {problems.length > 0 && (
              <span className="problems-badge">{problems.length}</span>
            )}
          </button>
        </div>

        <div className="output-drawer-actions">
          <span className="output-duration">
            {running && <Icon name="refresh" size={12} className="spin" />}
            {running ? 'Running…' : duration}
          </span>
          <button
            type="button"
            className="icon-button"
            title="Clear output"
            onClick={onClear}
          >
            <Icon name="trash" size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            title={collapsed ? 'Expand panel' : 'Collapse panel'}
            onClick={onToggleCollapsed}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="output-drawer-body">
          {tab === 'output' && (
            <div className="output-console">
              {logs.length === 0 ? (
                <div className="output-empty">
                  <div className="output-empty-prompt">›_</div>
                  <div>
                    <strong>Your output appears here</strong>
                    <p>Hit <kbd>Run</kbd> or press <kbd>Ctrl+Enter</kbd> to execute the current file.</p>
                  </div>
                </div>
              ) : (
                <pre className="output-log-lines">
                  {logs.map((entry, index) => (
                    <div key={index} className={`output-line is-${entry.type}`}>
                      {entry.text}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          )}

          {tab === 'input' && (
            <div className="output-input-pane">
              <p className="panel-note">Custom standard input passed to program execution:</p>
              <textarea
                className="output-stdin-textarea"
                placeholder="Enter input lines here..."
                value={stdin}
                onChange={(e) => onStdinChange(e.target.value)}
              />
            </div>
          )}

          {tab === 'problems' && (
            <div className="output-problems-pane">
              {problems.length === 0 ? (
                <p className="panel-note">No problems detected in the workspace.</p>
              ) : (
                <div className="problems-list">
                  {problems.map((prob, i) => (
                    <div key={i} className="problem-item">
                      <Icon name="warning" size={13} />
                      <span className="problem-file">{prob.file}:{prob.line}</span>
                      <span className="problem-message">{prob.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
