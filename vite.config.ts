import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiMiddleware, generateNewsArticleFromEvent } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
    const articleApiMiddleware = createArticleApiMiddleware({
      generateArticle: (event) => generateNewsArticleFromEvent(event, { apiKey }),
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
            server.middlewares.use(articleApiMiddleware);
          },
          configurePreviewServer(server) {
            server.middlewares.use(articleApiMiddleware);
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
