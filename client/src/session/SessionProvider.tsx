import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getGuestToken, resolveApiUrl, setGuestToken } from '../api';
import type { AuthUser, Role } from '../types';

export type GuestSession = {
  id: string;
  name: string;
  roomId: string;
  role: Role;
  token: string;
};

const GUEST_SESSION_KEY = 'codetogether.guestSession';

function readStoredGuest(): GuestSession | null {
  const token = getGuestToken();
  if (!token) return null;

  try {
    const stored = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored) as GuestSession;
    return session.token === token ? session : null;
  } catch {
    return null;
  }
}

type Credentials = { email: string; password: string };
type SignUpInput = Credentials & { name: string };

type SessionValue = {
  loading: boolean;
  user: AuthUser | null;
  guest: GuestSession | null;
  signUp: (input: SignUpInput) => Promise<string | null>;
  signIn: (input: Credentials) => Promise<string | null>;
  signOut: () => Promise<void>;
  startGuestSession: (session: GuestSession) => void;
  endGuestSession: () => void;
  renameSelf: (name: string) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guest, setGuest] = useState<GuestSession | null>(() => readStoredGuest());

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await api<{ user: AuthUser }>('/api/auth/me');
        if (!cancelled) {
          setUser(result.user);
        }
      } catch {
        // Not signed in is a normal starting state, not an error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const startGuestSession = useCallback((session: GuestSession) => {
    setGuestToken(session.token);
    sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
    setGuest(session);
  }, []);

  const endGuestSession = useCallback(() => {
    setGuestToken(null);
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    setGuest(null);
  }, []);

  /**
   * Signing up or in while in a guest session hands the server that guest
   * token, which turns the temporary identity into real membership of the room
   * the person is already looking at. Returns that room so the caller can send
   * them back to it instead of to an empty dashboard.
   */
  const authenticate = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<string | null> => {
      const guestToken = getGuestToken() ?? undefined;

      const result = await api<{ user: AuthUser; joinedRoomId: string | null }>(path, {
        method: 'POST',
        body: { ...body, guestToken },
      });

      endGuestSession();
      setUser(result.user);
      return result.joinedRoomId;
    },
    [endGuestSession],
  );

  const signUp = useCallback(
    (input: SignUpInput) => authenticate('/api/auth/signup', { ...input }),
    [authenticate],
  );

  const signIn = useCallback(
    (input: Credentials) => authenticate('/api/auth/login', { ...input }),
    [authenticate],
  );

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    endGuestSession();
    setUser(null);
  }, [endGuestSession]);

  const renameSelf = useCallback(async (name: string) => {
    const result = await api<{ user: AuthUser }>('/api/auth/me', {
      method: 'PATCH',
      body: { name },
    });
    setUser(result.user);
  }, []);

  const uploadAvatar = useCallback(async (file: File) => {
    const data = new FormData();
    data.set('photo', file);
    const response = await fetch(resolveApiUrl('/api/auth/me/avatar'), { method: 'POST', credentials: 'include', body: data });
    const payload = (await response.json()) as { user?: AuthUser; error?: string };
    if (!response.ok || !payload.user) throw new Error(payload.error ?? 'Could not upload profile photo.');
    setUser(payload.user);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      loading,
      user,
      guest,
      signUp,
      signIn,
      signOut,
      startGuestSession,
      endGuestSession,
      renameSelf,
      uploadAvatar,
    }),
    [loading, user, guest, signUp, signIn, signOut, startGuestSession, endGuestSession, renameSelf, uploadAvatar],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider.');
  return value;
}
