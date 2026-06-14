import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleGenerateArticleRequest } from './server/articleApi.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'server-side-gemini-api',
          configureServer(server) {
            server.middlewares.use('/api/generate-article', async (req, res) => {
              await handleGenerateArticleRequest(req, res, {
                apiKey: env.GEMINI_API_KEY || env.API_KEY,
              });
            });
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
