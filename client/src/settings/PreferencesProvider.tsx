import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useLocalSetting } from '../hooks/useLocalSetting';

export type Theme = 'dark' | 'light';

export const FONT_SIZES = [12, 13, 14, 15, 16, 18] as const;

type PreferencesValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
};

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocalSetting<Theme>('theme', 'dark');
  const [fontSize, setFontSize] = useLocalSetting<number>('fontSize', 14);

  // Every colour in the app is a CSS variable, so switching theme is just
  // swapping which set of values is in scope.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, fontSize, setFontSize }),
    [theme, setTheme, fontSize, setFontSize],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside a PreferencesProvider.');
  return value;
}
