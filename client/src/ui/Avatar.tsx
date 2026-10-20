const PRESENCE_COLORS = [
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

type AvatarProps = {
  name: string;
  color: string;
  size?: number;
  title?: string;
  ring?: boolean;
};

export function Avatar({ name, color, size = 28, title, ring = false }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span
      className={`avatar${ring ? ' avatar-ring' : ''}`}
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
      }}
      title={title ?? name}
    >
      {initials || name[0]?.toUpperCase() || '?'}
    </span>
  );
}

export function AvatarStack({
  people,
  limit = 4,
}: {
  people: { id: string; name: string; color: string }[];
  limit?: number;
}) {
  const shown = people.slice(0, limit);
  const overflow = people.length - shown.length;

  return (
    <div className="avatar-stack">
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} color={person.color} size={27} ring />
      ))}
      {overflow > 0 && <span className="avatar avatar-more">+{overflow}</span>}
    </div>
  );
}
