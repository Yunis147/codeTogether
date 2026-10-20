import { useCallback, useEffect, useState } from 'react';

/**
 * State backed by localStorage, used for the per-user preferences the PRD asks
 * to be remembered between sessions: theme, font size, and panel layout.
 */
export function useLocalSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const storageKey = `codetogether.${key}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? fallback : (JSON.parse(stored) as T);
    } catch {
      // Private browsing, a quota error, or a value written by an older build.
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Not being able to remember a preference is not worth an error.
    }
  }, [storageKey, value]);

  const update = useCallback((next: T) => setValue(next), []);

  return [value, update];
}
