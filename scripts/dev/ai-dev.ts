import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** In development AI works without starting the GPU/TTS backend. */
export function aiDevelopmentServer(): Plugin {
  let child: ChildProcess | undefined;
  let port = 0;
  return {
    name: 'voicestudio-codex-adapter',
    apply: 'serve',
    async config() {
      port = await new Promise<number>((resolve, reject) => {
        const socket = createServer();
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', () => {
          const address = socket.address();
          const selected = typeof address === 'object' && address ? address.port : 0;
          socket.close(error => error ? reject(error) : resolve(selected));
        });
      });
      return { server: { proxy: { '/backend/ai': {
        target: `http://127.0.0.1:${port}`,
        rewrite: path => path.replace(/^\/backend/, ''),
      } } } };
    },
    configResolved(config) {
      const proxy = config.server.proxy ?? {};
      if (proxy['/backend/ai']) config.server.proxy = { '/backend/ai': proxy['/backend/ai'], ...proxy };
    },
    configureServer(server) {
      const privatePython = join(process.env.LOCALAPPDATA ?? '', 'VoiceStudioNext', 'runtime', '.venv', 'Scripts', 'python.exe');
      const python = process.env.VOICESTUDIO_NEXT_PYTHON || (existsSync(privatePython) ? privatePython : 'python');
      const script = fileURLToPath(new URL('../runtime/app/ai_tagging.py', import.meta.url));
      child = spawn(python, ['-u', script, '--serve', '--port', String(port), '--parent-stdin'], {
        windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, VOICESTUDIO_DEV_ORIGINS: '1' },
      });
      child.on('error', () => server.config.logger.error('Nie można uruchomić lokalnego adaptera AI. Sprawdź interpreter Python i FastAPI.'));
      child.stderr?.on('data', (data: Buffer) => server.config.logger.warn(`[AI] ${data.toString().trim()}`));
      const stop = () => { child?.stdin?.end(); child = undefined; process.off('exit', stop); };
      process.once('exit', stop);
      server.httpServer?.once('close', stop);
    },
  };
}
