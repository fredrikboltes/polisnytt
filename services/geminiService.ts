
import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle> => {
  const response = await fetch('/api/generate-article', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate article: ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.article;
};
