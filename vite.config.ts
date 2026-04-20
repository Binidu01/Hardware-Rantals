import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { biniroute } from 'bini-router';
import { biniOverlay } from 'bini-overlay';
import { biniEnv } from 'bini-env';
import { biniExport } from 'bini-export';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  const env      = loadEnv(mode, process.cwd(), '');
  const isBuild  = command === 'build';
  const port     = parseInt(env['PORT'] ?? '3000', 10);
  const hmrConfig = env['CODESPACE_NAME']
    ? { clientPort: 443, overlay: false }
    : { overlay: false, host: 'localhost' };

  return {
    plugins: [
      tailwindcss(),
      react(),
      biniroute({ platform: 'node' }),
      biniOverlay(),
      biniEnv(),
      biniExport(),
    ],

    server: {
      port,
      host   : env['CODESPACE_NAME'] ? '0.0.0.0' : 'localhost',
      open   : true,
      cors   : true,
      headers: { 'Access-Control-Allow-Origin': '*' },
      hmr    : hmrConfig,
      watch  : {
        usePolling: !!env['CODESPACE_NAME'],
        ignored   : ['**/dist/**', '**/node_modules/**'],
      },
    },

    preview: { port, host: '0.0.0.0', open: true, cors: true },

    build: {
      outDir               : 'dist',
      sourcemap            : !isBuild,
      emptyOutDir          : true,
      minify               : isBuild,
      cssCodeSplit         : true,
      reportCompressedSize : true,
      chunkSizeWarningLimit: 1000,
      rolldownOptions: {
        output: {
          chunkFileNames: 'js/[name]-[hash].js',
          entryFileNames: 'js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] ?? assetInfo.name ?? '';
            const ext  = name.split('.').pop() ?? '';
            if (/png|jpe?g|gif|svg|webp|avif/.test(ext)) return 'assets/images/[name]-[hash][extname]';
            if (/woff2?|eot|ttf|otf/.test(ext))          return 'assets/fonts/[name]-[hash][extname]';
            if (ext === 'css')  return 'css/[name]-[hash][extname]';
            if (ext === 'json') return 'data/[name]-[hash][extname]';
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },

    resolve    : { alias: { '@': '/src' } },
    css        : { modules: { localsConvention: 'camelCase' }, devSourcemap: true },
    optimizeDeps: { include: ['react', 'react-dom', 'react-router-dom'] },
  };
});
