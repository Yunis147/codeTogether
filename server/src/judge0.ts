import { createZip, type ZipEntry } from './lib/zip.js';
import { env } from './env.js';

export type RunnableLanguage = 'python' | 'java' | 'javascript' | 'typescript' | 'c' | 'cpp';

export type ExecutionFile = {
  path: string;
  content: string;
};

export type ExecutionResult = {
  status: { id: number; description: string };
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  message: string | null;
  time: string | null;
  memory: number | null;
};

type Judge0Response = {
  status?: { id?: number; description?: string };
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
  error?: string;
};

const MULTI_FILE_LANGUAGE_ID = 89;
const REQUEST_TIMEOUT_MS = 20_000;

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`;
}

function classNameForJava(entryPath: string, source: string): string {
  const filename = entryPath.split('/').at(-1)?.replace(/\.java$/i, '') ?? 'Main';
  const packageName = /^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m.exec(source)?.[1];
  return packageName ? `${packageName}.${filename}` : filename;
}

function compiledTypeScriptPath(entryPath: string): string {
  return `.codetogether-build/${entryPath.replace(/\.ts$/i, '.js')}`;
}

function scriptsFor(language: RunnableLanguage, entryPath: string, entrySource: string): ZipEntry[] {
  const runScript = (command: string): ZipEntry => ({
    path: 'run',
    mode: 0o100755,
    content: `#!/bin/bash\nset -euo pipefail\nexec ${command}\n`,
  });
  const compileScript = (command: string): ZipEntry => ({
    path: 'compile',
    mode: 0o100755,
    content: `#!/bin/bash\nset -euo pipefail\n${command}\n`,
  });

  switch (language) {
    case 'python':
      return [runScript(`python3 -- ${quoteForShell(entryPath)}`)];
    case 'javascript':
      return [runScript(`node -- ${quoteForShell(entryPath)}`)];
    case 'typescript':
      return [
        compileScript(
          "mkdir -p .codetogether-build\nfind . -type f -name '*.ts' -print0 | xargs -0 tsc --target ES2020 --module commonjs --outDir .codetogether-build --rootDir .",
        ),
        runScript(`node -- ${quoteForShell(compiledTypeScriptPath(entryPath))}`),
      ];
    case 'c':
      return [
        compileScript(`gcc -std=c17 -O2 -Wall -Wextra ${quoteForShell(entryPath)} -lm -o .codetogether-program`),
        runScript('./.codetogether-program'),
      ];
    case 'cpp':
      return [
        compileScript(`g++ -std=c++17 -O2 -Wall -Wextra ${quoteForShell(entryPath)} -o .codetogether-program`),
        runScript('./.codetogether-program'),
      ];
    case 'java': {
      const className = classNameForJava(entryPath, entrySource);
      return [
        compileScript("find . -type f -name '*.java' -print0 | xargs -0 javac -d ."),
        runScript(`java ${quoteForShell(className)}`),
      ];
    }
  }
}

function judge0Headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(env.JUDGE0_AUTH_TOKEN ? { 'X-Auth-Token': env.JUDGE0_AUTH_TOKEN } : {}),
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Runs a generated project archive in Judge0. The shell scripts are generated
 * here from the selected language; workspace content is never run by Node.
 */
export async function executeProject({
  language,
  entryPath,
  entrySource,
  files,
  stdin,
}: {
  language: RunnableLanguage;
  entryPath: string;
  entrySource: string;
  files: ExecutionFile[];
  stdin: string;
}): Promise<ExecutionResult> {
  const archive = createZip([
    ...files.map((file) => ({ path: file.path, content: file.content })),
    ...scriptsFor(language, entryPath, entrySource),
  ]);

  let response: Response;
  try {
    response = await fetch(`${env.JUDGE0_URL}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers: judge0Headers(),
      body: JSON.stringify({
        language_id: MULTI_FILE_LANGUAGE_ID,
        additional_files: archive.toString('base64'),
        stdin,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Judge0Error('The code runner is unavailable. Start Judge0 with Docker and try again.', 503);
  }

  const body = (await response.json().catch(() => null)) as Judge0Response | null;
  if (!response.ok || !body) {
    const detail = body?.error ? ` (${body.error})` : '';
    throw new Judge0Error(`The code runner rejected this submission${detail}`, 502);
  }

  if (body.error) throw new Judge0Error(`The code runner rejected this submission (${body.error})`, 502);

  return {
    status: {
      id: typeof body.status?.id === 'number' ? body.status.id : 13,
      description: body.status?.description ?? 'Execution completed',
    },
    stdout: asNullableString(body.stdout),
    stderr: asNullableString(body.stderr),
    compileOutput: asNullableString(body.compile_output),
    message: asNullableString(body.message),
    time: asNullableString(body.time),
    memory: typeof body.memory === 'number' ? body.memory : null,
  };
}

export class Judge0Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
