import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  try {
    const response = await fetch("/api/generate-article", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error(`Article generation failed: ${response.status}`);
    }

    return await response.json() as NewsArticle;
  } catch (error) {
    console.error("Error generating news article:", error);
    return null;
  }
};
