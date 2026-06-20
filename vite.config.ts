import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { setupArticleApi } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiKey = env.GEMINI_API_KEY || env.API_KEY;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'article-api',
          configureServer(server) {
            setupArticleApi(server.middlewares, { apiKey });
          },
          configurePreviewServer(server) {
            setupArticleApi(server.middlewares, { apiKey });
          },
        },
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
