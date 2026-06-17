import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createArticleApiHandler } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const handleArticleApi = createArticleApiHandler({
      apiKey: env.GEMINI_API_KEY || env.API_KEY,
    });

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'server-only-article-api',
          configureServer(server) {
            server.middlewares.use('/api/generate-article', handleArticleApi);
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
