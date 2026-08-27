
import { PoliceEvent, NewsArticle } from "../types";

export const generateNewsArticle = async (
  event: PoliceEvent,
  locationName: string,
): Promise<NewsArticle> => {
  const response = await fetch('/api/generate-article', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ eventId: event.id, location: locationName }),
  });

  if (!response.ok) {
    throw new Error(`Article generation failed with status ${response.status}`);
  }

  return response.json() as Promise<NewsArticle>;
};
