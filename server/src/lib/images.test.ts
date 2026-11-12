import { describe, expect, it } from 'vitest';
import { imageExtension } from './images.js';

describe('avatar validation', () => {
  it('rejects active content regardless of the declared image MIME', () => {
    expect(imageExtension(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(imageExtension(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeNull();
  });
  it('derives the extension from a real image signature', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=', 'base64');
    expect(imageExtension(png)).toBe('.png');
  });
});
