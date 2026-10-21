import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getGuestToken } from '../api';
import type { Person } from '../types';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';

export type RoomChatMessage = {
  id: string;
  roomId: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: string;
};

export type LiveRoomPerson = Pick<Person, 'id' | 'name' | 'color' | 'role' | 'guest' | 'fileId'>;

type ChatAck = { ok: true } | { ok: false; error: string };

type ChatPanelProps = {
  roomId: string;
  selfId: string;
  activeFileId: string | null;
  open: boolean;
  onClose: () => void;
  onIncomingMessage: (message: RoomChatMessage) => void;
  onPresenceChange: (people: LiveRoomPerson[]) => void;
  onRoomRenamed: (name: string) => void;
};

function chatOrigin(): string {
  return import.meta.env.VITE_API_URL ?? window.location.origin;
}

function mergeMessages(current: RoomChatMessage[], next: RoomChatMessage[]): RoomChatMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of next) messages.set(message.id, message);
  return Array.from(messages.values()).sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function ChatPanel({
  roomId,
  selfId,
  activeFileId,
  open,
  onClose,
  onIncomingMessage,
  onPresenceChange,
  onRoomRenamed,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<RoomChatMessage[]>([]);
  const [content, setContent] = useState('');
  const [state, setState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const focusOnConnectRef = useRef(open);

  useEffect(() => {
    if (!open) {
      focusOnConnectRef.current = false;
      return;
    }

    focusOnConnectRef.current = true;
  }, [open]);

  useEffect(() => {
    if (!open || state !== 'connected' || !focusOnConnectRef.current) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    focusOnConnectRef.current = false;
    return () => window.cancelAnimationFrame(frame);
  }, [open, state]);

  useEffect(() => {
    const socket = io(chatOrigin(), {
      path: '/socket.io',
      auth: { token: getGuestToken() ?? undefined },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    const join = (): void => {
      setState('connecting');
      socket.emit('chat:join', { roomId }, (result: ChatAck) => {
        if (result.ok) {
          setState('connected');
          setError(null);
        } else {
          setState('error');
          setError(result.error);
        }
      });
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setState('connecting'));
    socket.on('connect_error', () => {
      setState('error');
      setError('Chat could not connect. Retrying…');
    });
    socket.on('chat:history', (history: RoomChatMessage[]) => {
      setMessages((current) => mergeMessages(current, history));
    });
    socket.on('chat:message', (message: RoomChatMessage) => {
      setMessages((current) => mergeMessages(current, [message]));
      if (message.authorId !== selfId) onIncomingMessage(message);
    });
    socket.on('room:presence', (people: LiveRoomPerson[]) => onPresenceChange(people));
    socket.on('room:renamed', ({ name }: { name: string }) => onRoomRenamed(name));

    return () => {
      socket.disconnect();
      socketRef.current = null;
      onPresenceChange([]);
    };
  }, [roomId, selfId, onIncomingMessage, onPresenceChange, onRoomRenamed]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (state !== 'connected') return;
    socketRef.current?.emit('room:active-file', { fileId: activeFileId });
  }, [activeFileId, state]);

  const send = (): void => {
    const text = content.trim();
    const socket = socketRef.current;
    if (!text || !socket || state !== 'connected' || sending) return;

    setSending(true);
    socket.emit('chat:send', { content: text }, (result: ChatAck) => {
      setSending(false);
      if (result.ok) {
        setContent('');
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <aside className={`chat-panel${open ? '' : ' is-hidden'}`} aria-label="Room conversation" aria-hidden={!open}>
      <header className="chat-head">
        <div>
          <p className="eyebrow">Room conversation</p>
          <h2>Chat</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} title="Close chat" aria-label="Close chat">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="chat-connection" aria-live="polite">
        <span className={`chat-state-dot is-${state}`} />
        {state === 'connected' ? 'Everyone in this room can see these messages.' : error ?? 'Connecting to chat…'}
      </div>

      <div className="chat-messages" ref={messageListRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <Icon name="chat" size={24} />
            <strong>Start the conversation</strong>
            <p>Share an idea, a question, or a quick update with the room.</p>
          </div>
        ) : (
          messages.map((message) => {
            const yours = message.authorId === selfId;
            return (
              <article className={`chat-message${yours ? ' is-yours' : ''}`} key={message.id}>
                <Avatar name={message.authorName} color={message.authorColor} size={26} />
                <div className="chat-message-body">
                  <header>
                    <strong>{yours ? 'You' : message.authorName}</strong>
                    <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                  </header>
                  <p>{message.content}</p>
                </div>
              </article>
            );
          })
        )}
      </div>

      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">Message the room</label>
        <textarea
          id="chat-message"
          ref={inputRef}
          value={content}
          maxLength={2000}
          disabled={state !== 'connected' || sending}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Message your team…"
          rows={2}
        />
        <div className="chat-compose-footer">
          <span>Enter to send · Shift + Enter for a new line</span>
          <button type="submit" className="chat-send" disabled={!content.trim() || state !== 'connected' || sending}>
            <Icon name="send" size={16} />
            <span>Send</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
