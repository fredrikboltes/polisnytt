import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleGenerateArticleRequest } from './server/articleApi.mjs';

export default defineConfig(() => {
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
              await handleGenerateArticleRequest(req, res);
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
