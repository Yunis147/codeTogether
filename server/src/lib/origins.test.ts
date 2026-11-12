import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
vi.mock('../env.js', () => ({ env: { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://app.example,https://preview.example' } }));
import { browserOrigins, isAllowedOrigin } from './origins.js';

describe('browser origin protection', () => {
  it('permits only the explicit browser origins in production', () => {
    expect(isAllowedOrigin('https://app.example')).toBe(true);
    expect(isAllowedOrigin('https://app.example/')).toBe(true);
    expect(isAllowedOrigin('https://preview.example')).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(false);
  });
  it('rejects simple cross-site POSTs before a state-changing route can run', () => {
    const json = vi.fn(); const status = vi.fn(() => ({ json })); const next = vi.fn();
    browserOrigins({ method: 'POST', headers: { origin: 'https://evil.example' } } as Request,
      { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
});
