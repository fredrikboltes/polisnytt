
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
      let message = `Article generation failed with status ${response.status}`;
      try {
        const payload = await response.json();
        if (typeof payload?.error === "string") {
          message = payload.error;
        }
      } catch {
        // Keep the status-based message if the server did not return JSON.
      }
      throw new Error(message);
    }

    return await response.json() as NewsArticle;
  } catch (error) {
    console.error("Error generating news article with Gemini:", error);
    return null;
  }
};
