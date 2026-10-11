import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';
import { tauntsApi } from './server/taunts.js';

// Webcam access needs a secure context (https or localhost). The self-signed certificate
// lets other devices on the network open the game at https://<server-ip>:<port>; the
// browser shows a certificate warning once, which you accept to continue.
export default defineConfig(({ mode }) => ({
  base: './',
  // GEMINI_API_KEY (and optional GEMINI_MODEL) come from web/.env.local and stay server-side.
  plugins: [basicSsl({ name: 'celestisign-dev' }), tauntsApi(loadEnv(mode, process.cwd(), ''))],
  server: { host: true },
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page the first time
  // practice mode imports three.js.
  optimizeDeps: { include: ['three'] },
  preview: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
}));
