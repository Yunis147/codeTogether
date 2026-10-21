/** Extension to Monaco language id, plus the little file-type badge in the tree. */
const LANGUAGES: Record<string, { language: string; badge: string; tint: string }> = {
  ts: { language: 'typescript', badge: 'TS', tint: 'blue' },
  tsx: { language: 'typescript', badge: 'TSX', tint: 'blue' },
  js: { language: 'javascript', badge: 'JS', tint: 'yellow' },
  jsx: { language: 'javascript', badge: 'JSX', tint: 'yellow' },
  mjs: { language: 'javascript', badge: 'JS', tint: 'yellow' },
  cjs: { language: 'javascript', badge: 'JS', tint: 'yellow' },
  json: { language: 'json', badge: '{ }', tint: 'violet' },
  html: { language: 'html', badge: '<>', tint: 'orange' },
  css: { language: 'css', badge: '#', tint: 'blue' },
  scss: { language: 'scss', badge: '#', tint: 'pink' },
  md: { language: 'markdown', badge: 'M', tint: 'grey' },
  py: { language: 'python', badge: 'PY', tint: 'green' },
  java: { language: 'java', badge: 'JV', tint: 'orange' },
  c: { language: 'c', badge: 'C', tint: 'blue' },
  h: { language: 'c', badge: 'H', tint: 'blue' },
  cpp: { language: 'cpp', badge: 'C+', tint: 'blue' },
  cc: { language: 'cpp', badge: 'C+', tint: 'blue' },
  cxx: { language: 'cpp', badge: 'C+', tint: 'blue' },
  cs: { language: 'csharp', badge: 'C#', tint: 'violet' },
  go: { language: 'go', badge: 'GO', tint: 'teal' },
  rs: { language: 'rust', badge: 'RS', tint: 'orange' },
  rb: { language: 'ruby', badge: 'RB', tint: 'pink' },
  php: { language: 'php', badge: 'PHP', tint: 'violet' },
  sql: { language: 'sql', badge: 'SQL', tint: 'teal' },
  sh: { language: 'shell', badge: 'SH', tint: 'grey' },
  yml: { language: 'yaml', badge: 'YML', tint: 'grey' },
  yaml: { language: 'yaml', badge: 'YML', tint: 'grey' },
  xml: { language: 'xml', badge: 'XML', tint: 'orange' },
  txt: { language: 'plaintext', badge: 'TXT', tint: 'grey' },
};

const FALLBACK = { language: 'plaintext', badge: '•', tint: 'grey' } as const;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function languageFor(name: string): string {
  return LANGUAGES[extensionOf(name)]?.language ?? FALLBACK.language;
}

export function badgeFor(name: string): { badge: string; tint: string } {
  const entry = LANGUAGES[extensionOf(name)] ?? FALLBACK;
  return { badge: entry.badge, tint: entry.tint };
}

export function languageLabel(language: string | null): string {
  if (!language) return 'Plain Text';

  const named: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    json: 'JSON',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    markdown: 'Markdown',
    python: 'Python',
    java: 'Java',
    csharp: 'C#',
    cpp: 'C++',
    c: 'C',
    go: 'Go',
    rust: 'Rust',
    ruby: 'Ruby',
    php: 'PHP',
    sql: 'SQL',
    shell: 'Shell',
    yaml: 'YAML',
    xml: 'XML',
    plaintext: 'Plain Text',
  };

  return named[language] ?? language;
}

/** Languages offered in the status-bar picker, for overriding what the name implies. */
export const LANGUAGE_CHOICES = [
  'typescript',
  'javascript',
  'json',
  'html',
  'css',
  'markdown',
  'python',
  'java',
  'c',
  'cpp',
  'go',
  'rust',
  'sql',
  'shell',
  'yaml',
  'plaintext',
] as const;
