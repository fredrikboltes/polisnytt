import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiMiddleware } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
    const articleApiPlugin = {
      name: 'article-api',
      configureServer(server) {
        server.middlewares.use(createArticleApiMiddleware({ apiKey }));
      },
      configurePreviewServer(server) {
        server.middlewares.use(createArticleApiMiddleware({ apiKey }));
      },
    };

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), articleApiPlugin],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
