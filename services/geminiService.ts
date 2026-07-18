
import { PoliceEvent, NewsArticle } from '../types';

const isNewsArticle = (value: unknown): value is NewsArticle => {
  if (!value || typeof value !== 'object') return false;

  const article = value as Record<string, unknown>;
  return (
    typeof article.id === 'string'
    && typeof article.originalEventId === 'number'
    && typeof article.title === 'string'
    && typeof article.lead === 'string'
    && typeof article.body === 'string'
    && typeof article.category === 'string'
    && typeof article.location === 'string'
    && typeof article.timestamp === 'string'
    && typeof article.imageUrl === 'string'
  );
};

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle> => {
  const response = await fetch('/api/generate-article', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event }),
  });

  if (!response.ok) {
    throw new Error(`Article generation failed with status ${response.status}`);
  }

  const result: unknown = await response.json();
  if (
    !result
    || typeof result !== 'object'
    || !isNewsArticle((result as Record<string, unknown>).article)
  ) {
    throw new Error('Article generation returned an invalid article');
  }

  return (result as { article: NewsArticle }).article;
};
