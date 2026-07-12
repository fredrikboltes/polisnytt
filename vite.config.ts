import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { installArticleApiMiddleware } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const articleApiOptions = { apiKey: env.GEMINI_API_KEY || env.API_KEY };

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
            installArticleApiMiddleware(server.middlewares, articleApiOptions);
          },
          configurePreviewServer(server) {
            installArticleApiMiddleware(server.middlewares, articleApiOptions);
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
