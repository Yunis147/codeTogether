const GUEST_TOKEN_KEY = 'codetogether.guestToken';

/**
 * A guest has no cookie, so their signed token travels as a bearer header.
 * It lives in sessionStorage: a refresh keeps them in the room, a new tab makes
 * them join again, and closing the browser ends it.
 */
let guestToken: string | null = sessionStorage.getItem(GUEST_TOKEN_KEY);

export function setGuestToken(token: string | null): void {
  guestToken = token;
  if (token) sessionStorage.setItem(GUEST_TOKEN_KEY, token);
  else sessionStorage.removeItem(GUEST_TOKEN_KEY);
}

export function getGuestToken(): string | null {
  return guestToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const { body, headers, ...rest } = options;

  const response = await fetch(resolveApiUrl(path), {
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(guestToken ? { Authorization: `Bearer ${guestToken}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...rest,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? 'Something went wrong.', response.status);
  }

  return response;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

/** Used by export, which returns a zip rather than JSON. */
export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await request(path);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);

  return { blob: await response.blob(), filename: match?.[1] ?? 'project.zip' };
}
