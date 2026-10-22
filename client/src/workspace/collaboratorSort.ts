import type { Person, Role } from '../types';

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 0,
  EDITOR: 1,
  VIEWER: 2,
};

export function sortCollaborators(people: Person[]): Person[] {
  return [...people].sort((left, right) => {
    const leftRole = (left.role?.toUpperCase() ?? '') as Role;
    const rightRole = (right.role?.toUpperCase() ?? '') as Role;

    const rankLeft = ROLE_RANK[leftRole] ?? 99;
    const rankRight = ROLE_RANK[rightRole] ?? 99;

    if (rankLeft !== rankRight) {
      return rankLeft - rankRight;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}
