import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') {
      return new Worker(
        new URL('../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
        { type: 'module' },
      );
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new Worker(
        new URL('../../../node_modules/monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
        { type: 'module' },
      );
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new Worker(
        new URL('../../../node_modules/monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
        { type: 'module' },
      );
    }
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(
        new URL('../../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
        { type: 'module' },
      );
    }
    return new Worker(
      new URL('../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
      { type: 'module' },
    );
  },
};

/**
 * Hand `@monaco-editor/react` the bundled copy of Monaco. Without this it
 * fetches its own from a CDN, which means the app ships two copies of Monaco and
 * y-monaco ends up binding against a different instance than the one on screen.
 */
loader.config({ monaco });

// Configure TypeScript / JavaScript language service defaults
const tsLanguages = (
  monaco.languages as unknown as {
    typescript?: {
      typescriptDefaults: {
        setCompilerOptions: (options: Record<string, unknown>) => void;
        setDiagnosticsOptions: (options: Record<string, unknown>) => void;
      };
      javascriptDefaults: {
        setCompilerOptions: (options: Record<string, unknown>) => void;
        setDiagnosticsOptions: (options: Record<string, unknown>) => void;
      };
    };
  }
).typescript;

if (tsLanguages) {
  tsLanguages.typescriptDefaults.setCompilerOptions({
    target: 99,
    allowNonTsExtensions: true,
    moduleResolution: 2,
    module: 1,
    noEmit: true,
    allowJs: true,
  });

  tsLanguages.javascriptDefaults.setCompilerOptions({
    target: 99,
    allowNonTsExtensions: true,
    allowJs: true,
  });

  tsLanguages.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  tsLanguages.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
}

const EDITOR_THEME_DARK = 'codetogether-dark';
const EDITOR_THEME_LIGHT = 'codetogether-light';

monaco.editor.defineTheme(EDITOR_THEME_DARK, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6d7689', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c3a6ff' },
    { token: 'string', foreground: '9ae6a0' },
    { token: 'number', foreground: 'ffbd8b' },
    { token: 'type', foreground: '7ce6d6' },
    { token: 'function', foreground: '8ab9ff' },
  ],
  colors: {
    'editor.background': '#0e1118',
    'editor.foreground': '#dfe4ef',
    'editorLineNumber.foreground': '#4a5365',
    'editorLineNumber.activeForeground': '#9aa5b8',
    'editor.selectionBackground': '#2c2745',
    'editor.lineHighlightBackground': '#141821',
    'editorIndentGuide.background1': '#1d222d',
    'editorCursor.foreground': '#ad96ff',
    'editorWidget.background': '#151923',
    'editorWidget.border': '#272c39',
    'editorGutter.background': '#0e1118',
  },
});

monaco.editor.defineTheme(EDITOR_THEME_LIGHT, {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8a93a6', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6d44c9' },
    { token: 'string', foreground: '1f7a4d' },
    { token: 'number', foreground: 'b4591b' },
    { token: 'type', foreground: '0f7c84' },
    { token: 'function', foreground: '2a5fb8' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#28303f',
    'editorLineNumber.foreground': '#aab2c1',
    'editorLineNumber.activeForeground': '#5c6578',
    'editor.selectionBackground': '#e3dbff',
    'editor.lineHighlightBackground': '#f6f7fb',
    'editorCursor.foreground': '#6d44c9',
    'editorGutter.background': '#ffffff',
  },
});

export function editorThemeFor(theme: 'dark' | 'light'): string {
  return theme === 'light' ? EDITOR_THEME_LIGHT : EDITOR_THEME_DARK;
}

export { monaco };
