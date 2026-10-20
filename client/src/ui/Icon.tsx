import type { SVGProps } from 'react';

/**
 * One stroked icon set, so every glyph in the app shares a weight and corner
 * style. Paths are drawn on a 24×24 grid.
 */
const PATHS = {
  files: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  search: 'M10.8 4a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6m5.2 12 4.5 4.5',
  rooms: 'M4.5 4h15A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-13A1.5 1.5 0 0 1 4.5 4M8 9h8M8 13h5',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6m7.4 3c0 .5 0 1-.1 1.4l2 1.6-2 3.4-2.4-1a7.4 7.4 0 0 1-2.4 1.4L14 22h-4l-.5-2.2a7.4 7.4 0 0 1-2.4-1.4l-2.4 1-2-3.4 2-1.6a8 8 0 0 1 0-2.8l-2-1.6 2-3.4 2.4 1a7.4 7.4 0 0 1 2.4-1.4L10 2h4l.5 2.2a7.4 7.4 0 0 1 2.4 1.4l2.4-1 2 3.4-2 1.6c.1.4.1.9.1 1.4',
  chat: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-1-4.5A7.5 7.5 0 1 1 20 11.5M8 10h8M8 13.5h5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-7 8a7 7 0 0 1 14 0',
  plus: 'M12 5v14M5 12h14',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5M12 11v6M9 14h6',
  folderPlus:
    'M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM12 11v5M9.5 13.5h5',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  share: 'M12 16V4m0 0L7 9m5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5',
  download: 'M12 4v12m0 0 5-5m-5 5-5-5M5 19h14',
  upload: 'M12 20V8m0 0 5 5m-5-5-5 5M5 4h14',
  play: 'M8 5l11 7-11 7z',
  close: 'M6 6l12 12M18 6 6 18',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1m-3 7H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check: 'M5 13l4 4L19 7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  pencil: 'M4 20h4L20 8l-4-4L4 16zM15 5l4 4',
  logout: 'M15 5V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1M11 12h10m0 0-4-4m4 4-4 4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5',
  follow: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3',
  warning: 'M12 4 2.5 20h19zM12 10v4m0 3h.01',
  link: 'M9 15l6-6M10.5 6.5 12 5a4.2 4.2 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4.2 4.2 0 0 1-6-6l1.5-1.5',
  undo: 'M9 10H4V5m0 5 3.5-3.5a8 8 0 1 1-1 11',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 3-2M19 13a10 10 0 0 0-7-2.9M11.99 20h.01',
  online: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M11.99 20h.01M2 9a14 14 0 0 1 20 0',
} as const;

export type IconName = keyof typeof PATHS;

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 17, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <BrandMark />
      {!compact && (
        <strong>
          code<span>Together</span>
        </strong>
      )}
    </span>
  );
}
