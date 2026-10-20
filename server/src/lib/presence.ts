/**
 * Presence colours. The server is the only place these are assigned, so a
 * client cannot pick a colour that impersonates someone else, and every peer
 * sees the same colour for the same person.
 */
export const PRESENCE_COLORS = [
  '#ad96ff',
  '#ffbd8b',
  '#7ce6d6',
  '#8ab9ff',
  '#f0a5d5',
  '#9ae6a0',
  '#ff9f9f',
  '#c9b8ff',
] as const;

export function colorFor(value: string): string {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    total = (total * 31 + value.charCodeAt(index)) % 1_000_003;
  }
  return PRESENCE_COLORS[total % PRESENCE_COLORS.length];
}
