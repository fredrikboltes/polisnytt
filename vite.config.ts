import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiMiddleware } from './server/articleApi.mjs';

const articleApiPlugin = (apiKey?: string): Plugin => ({
  name: 'article-api',
  configureServer(server) {
    server.middlewares.use(createArticleApiMiddleware({ apiKey }));
  },
  configurePreviewServer(server) {
    server.middlewares.use(createArticleApiMiddleware({ apiKey }));
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), articleApiPlugin(env.GEMINI_API_KEY || env.API_KEY)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
