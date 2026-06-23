
import { PoliceEvent, NewsArticle } from "../types";

interface GeneratedArticlePayload {
  title: string;
  lead: string;
  body: string;
  category: string;
}

const isGeneratedArticlePayload = (value: unknown): value is GeneratedArticlePayload => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const article = value as Record<string, unknown>;
  return (
    typeof article.title === "string" &&
    typeof article.lead === "string" &&
    typeof article.body === "string" &&
    typeof article.category === "string"
  );
};

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  try {
    const response = await fetch("/api/generate-news-article", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event }),
    });

    if (!response.ok) {
      throw new Error(`Article generation failed: ${response.status}`);
    }

    const result = await response.json();
    if (!isGeneratedArticlePayload(result)) {
      throw new Error("Article generation returned an invalid payload");
    }

    const imageUrl = `https://picsum.photos/seed/${event.id}/800/450`;

    return {
      id: `article-${event.id}-${Date.now()}`,
      originalEventId: event.id,
      title: result.title,
      lead: result.lead,
      body: result.body,
      category: result.category,
      location: event.location.name,
      timestamp: event.datetime,
      imageUrl: imageUrl
    };
  } catch (error) {
    console.error("Error generating news article with Gemini:", error);
    return null;
  }
};
