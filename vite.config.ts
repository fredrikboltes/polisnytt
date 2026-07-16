import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiHandler } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const articleApi = () => ({
      name: 'article-api',
      configureServer(server: { middlewares: { use: (handler: ReturnType<typeof createArticleApiHandler>) => void } }) {
        server.middlewares.use(createArticleApiHandler({ apiKey: env.GEMINI_API_KEY }));
      },
      configurePreviewServer(server: { middlewares: { use: (handler: ReturnType<typeof createArticleApiHandler>) => void } }) {
        server.middlewares.use(createArticleApiHandler({ apiKey: env.GEMINI_API_KEY }));
      },
    });

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), articleApi()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
