import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  /* The dev proxy must follow the SERVER's port. The server reads its port
     from the project-root .env (one level up from client/), so read the same
     file here — otherwise a non-default PORT (e.g. a deploy copy running
     beside the main checkout) would proxy /api to the wrong server. */
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '');
  /* ignore a leaked PORT=0/"" (loadEnv merges process.env over the files):
     an invalid env PORT must NOT shadow the .env FILE's value — read the
     file directly as the fallback so the proxy follows the real server. */
  const fromFile = (() => {
    try {
      const raw = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
      const m = raw.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
      return m && Number(m[1]) > 0 ? m[1] : null;
    } catch {
      return null;
    }
  })();
  /* PNBIND: for parallel dev sessions (two checkouts side by side) the
     server port can be pinned via env without touching .env, which the
     other checkout's vite would also read. */
  const bindPort = rootEnv.PNBIND_API_PORT && Number(rootEnv.PNBIND_API_PORT) > 0 ? String(rootEnv.PNBIND_API_PORT) : null;
  const apiPort = bindPort ?? fromFile ?? '4000';
  /* PNBIND: pin the VITE dev port the same way (a second checkout cannot
     share 5173 with the first one). */
  const vitePort = rootEnv.PNBIND_VITE_PORT && Number(rootEnv.PNBIND_VITE_PORT) > 0 ? Number(rootEnv.PNBIND_VITE_PORT) : 5173;

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: vitePort,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1600,
    },
  };
});
