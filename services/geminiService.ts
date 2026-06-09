import type { PoliceEvent, NewsArticle } from "../types";

interface GenerateArticleResponse {
  article?: NewsArticle | null;
  error?: string;
}

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  const response = await fetch("/api/generate-article", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event }),
  });

  const data = await response.json().catch(() => ({})) as GenerateArticleResponse;

  if (!response.ok) {
    throw new Error(data.error || "Failed to generate news article.");
  }

  if (data.article === undefined) {
    throw new Error("Invalid article response from server.");
  }

  return data.article;
};
