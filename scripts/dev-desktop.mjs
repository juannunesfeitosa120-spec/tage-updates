import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentUrl = 'http://127.0.0.1:5173';

const server = await createServer({
  configFile: path.join(projectRoot, 'desktop', 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

const electron = spawn(electronExecutable, ['.'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    TAGGI_DESKTOP_DEV_URL: developmentUrl,
  },
  stdio: 'inherit',
});

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!electron.killed) electron.kill();
  await server.close();
  process.exitCode = exitCode;
}

electron.once('exit', (code) => {
  void stop(code ?? 0);
});
electron.once('error', (error) => {
  console.error('Não foi possível abrir o Tage em desenvolvimento.', error);
  void stop(1);
});
process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));
