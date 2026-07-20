import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ArticleApiOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  generateArticle?: (event: unknown, apiKey?: string) => Promise<unknown>;
  now?: () => number;
}

export function createArticleApi(options?: ArticleApiOptions): (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => Promise<void>;
