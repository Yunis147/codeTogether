import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import { sortCollaborators } from './collaboratorSort';

function createMockPerson(name: string, role: Person['role']): Person {
  return {
    clientId: Math.floor(Math.random() * 1000),
    id: `id-${name}`,
    name,
    color: '#123456',
    role,
    guest: false,
    fileId: null,
    isYou: false,
  };
}

describe('sortCollaborators', () => {
  it('places owners first, then editors (alphabetical), then viewers (alphabetical)', () => {
    const list: Person[] = [
      createMockPerson('Zoe (Viewer)', 'VIEWER'),
      createMockPerson('Bob (Editor)', 'EDITOR'),
      createMockPerson('Zack (Owner)', 'OWNER'),
      createMockPerson('Alice (Editor)', 'EDITOR'),
      createMockPerson('Charlie (Viewer)', 'VIEWER'),
      createMockPerson('Aaron (Owner)', 'OWNER'),
      createMockPerson('adam (editor)', 'EDITOR'),
    ];

    const sorted = sortCollaborators(list);
    const sortedNames = sorted.map((p) => p.name);

    expect(sortedNames).toEqual([
      // Owners first (alphabetical)
      'Aaron (Owner)',
      'Zack (Owner)',
      // Editors second (alphabetical, case-insensitive)
      'adam (editor)',
      'Alice (Editor)',
      'Bob (Editor)',
      // Viewers third (alphabetical)
      'Charlie (Viewer)',
      'Zoe (Viewer)',
    ]);
  });
});
