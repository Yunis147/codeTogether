import type { ZipEntry } from './zip.js';

type FileRow = { id: string; parentId: string | null; name: string; type: string; textContent: string | null };

export function pathSegment(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').trim().replace(/[. ]+$/, '');
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

/** Allocate safe sibling names before building paths, including folder collisions. */
export function zipEntriesFor(files: FileRow[]): ZipEntry[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const names = new Map<string, string>();
  const used = new Map<string | null, Set<string>>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const parent = file.parentId && byId.has(file.parentId) ? file.parentId : null;
    const siblings = used.get(parent) ?? new Set<string>();
    used.set(parent, siblings);
    const base = pathSegment(file.name);
    const dot = file.type === 'FILE' ? base.lastIndexOf('.') : -1;
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : '';
    let name = base;
    let suffix = 2;
    while (siblings.has(name.toLowerCase())) name = `${stem} (${suffix++})${extension}`;
    siblings.add(name.toLowerCase());
    names.set(file.id, name);
  }
  return files.map((file) => {
    const segments: string[] = [];
    const seen = new Set<string>();
    let node: FileRow | undefined = file;
    while (node && !seen.has(node.id)) {
      seen.add(node.id); segments.unshift(names.get(node.id)!);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    const path = segments.join('/');
    return file.type === 'FOLDER' ? { path: `${path}/` } : { path, content: file.textContent ?? '' };
  }).sort((a, b) => a.path.localeCompare(b.path));
}

export function downloadDisposition(name: string): string {
  const filename = `${pathSegment(name).replace(/\s+/g, '-').toLowerCase() || 'project'}.zip`;
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
