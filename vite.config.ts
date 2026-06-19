import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createGenerateArticleHandler } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || process.env.API_KEY || env.API_KEY;
    const articleHandler = createGenerateArticleHandler({ apiKey });

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'gemini-article-api',
          configureServer(server) {
            server.middlewares.use('/api/generate-article', articleHandler);
          },
          configurePreviewServer(server) {
            server.middlewares.use('/api/generate-article', articleHandler);
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
