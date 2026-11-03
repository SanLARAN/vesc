import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * PWA PNG icons are kept as base64 text in branding/icons/*.png.b64 (regenerate
 * with branding/make-icons.mjs) and emitted next to manifest.json at build time.
 */
function pwaIcons(): Plugin {
  const dir = fileURLToPath(new URL('./branding/icons/', import.meta.url));
  const load = () =>
    Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith('.png.b64'))
        .map((f) => [f.slice(0, -'.b64'.length), Buffer.from(readFileSync(dir + f, 'utf8').trim(), 'base64')] as const)
    );
  return {
    name: 'pwa-icons',
    configureServer(server) {
      const icons = load();
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].split('/').pop() ?? '';
        if (!icons[name]) return next();
        res.setHeader('Content-Type', 'image/png');
        res.end(icons[name]);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(load())) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}

export default defineConfig({
  base: '/vesc/',
  plugins: [react(), tailwindcss(), pwaIcons()],
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
});
