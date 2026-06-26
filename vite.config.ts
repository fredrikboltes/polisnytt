import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiHandler } from './server/articleApi.mjs';

const articleApiPlugin = (apiKey?: string) => ({
  name: 'article-api',
  configureServer(server) {
    server.middlewares.use('/api/generate-article', createArticleApiHandler({ apiKey }));
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/generate-article', createArticleApiHandler({ apiKey }));
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const geminiApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), articleApiPlugin(geminiApiKey)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
