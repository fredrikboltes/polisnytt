
import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  try {
    const response = await fetch('/api/generate-article', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error(`Failed to generate article: ${response.status}`);
    }

    const { article } = await response.json();
    return article;
  } catch (error) {
    console.error("Error generating news article with Gemini:", error);
    return null;
  }
};
