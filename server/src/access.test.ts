import { describe, expect, it } from 'vitest';
import { cookieFromHeader } from './access.js';

describe('cookieFromHeader', () => {
  it('extracts the signed session token from a Socket.IO Cookie header', () => {
    expect(cookieFromHeader('theme=light; ct_session=signed%2Etoken; other=value', 'ct_session')).toBe('signed.token');
  });
});
