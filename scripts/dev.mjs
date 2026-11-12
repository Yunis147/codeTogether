import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const compose = process.platform === 'win32' ? 'docker.exe' : 'docker';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = new Set();
let stopping = false;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const envFile = await readFile(path.join(root, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch {
  console.error('Missing .env. Copy .env.example to .env, then run npm run dev again.');
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd'), ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function start(command, args, name) {
  const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
  children.add(child);
  child.on('error', (error) => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', (code) => {
    children.delete(child);
    if (!stopping && code !== 0) stop(code ?? 1);
  });
}

function waitForPort(port, host = '127.0.0.1', timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(check, 100);
      };
      socket.on('error', retry);
      socket.on('timeout', retry);
      socket.connect(port, host);
    };
    check();
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  if (code !== 0) process.exitCode = code;
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

try {
  console.log('Starting PostgreSQL and Judge0 with Docker Compose...');
  await run(compose, ['compose', 'up', '-d', '--wait', 'db', 'judge0-server', 'judge0-workers']);
  console.log('Preparing the database schema...');
  await run(npm, ['run', 'db:push']);
  console.log('Starting the API and web client...');
  start(npm, ['run', 'dev', '--workspace=server']);
  await waitForPort(Number(process.env.PORT) || 3001);
  start(npm, ['run', 'dev', '--workspace=client']);
} catch (error) {
  console.error(error.message);
  stop(1);
}
