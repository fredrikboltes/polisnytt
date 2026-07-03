import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiMiddleware } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const articleApiMiddleware = createArticleApiMiddleware({
      apiKey: env.GEMINI_API_KEY || env.API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY,
    });

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
            server.middlewares.use('/api/generate-article', articleApiMiddleware);
          },
          configurePreviewServer(server) {
            server.middlewares.use('/api/generate-article', articleApiMiddleware);
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
