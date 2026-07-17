
import { PoliceEvent, NewsArticle } from '../types';

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

  const result = await response.json();
  if (!result.article) {
    throw new Error('Article generation returned no article');
  }

  return result.article as NewsArticle;
};
