
import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  try {
    const response = await fetch("/api/generate-article", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error(`Article generation failed: ${response.status}`);
    }

    const data = await response.json();
    return data.article;
  } catch (error) {
    console.error("Error generating news article with Gemini:", error);
    return null;
  }
};
