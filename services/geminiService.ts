
import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (
  event: PoliceEvent,
  county: string,
): Promise<NewsArticle | null> => {
  try {
    const response = await fetch('/api/generate-article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: event.id, county }),
    });
    if (!response.ok) throw new Error(`Article API returned ${response.status}`);
    return await response.json() as NewsArticle;
  } catch (error) {
    console.error("Error generating news article:", error);
    return null;
  }
};
