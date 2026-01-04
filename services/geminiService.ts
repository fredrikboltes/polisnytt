
import { GoogleGenAI, Type } from "@google/genai";
import { PoliceEvent, NewsArticle } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

export const generateNewsArticle = async (event: PoliceEvent): Promise<NewsArticle | null> => {
  try {
    const prompt = `
      Förvandla följande polisrapport till en professionell, objektiv men engagerande nyhetsartikel på svenska.
      
      Händelseinfo:
      Titel: ${event.name}
      Sammanfattning: ${event.summary}
      Plats: ${event.location.name}
      Typ: ${event.type}
      Tid: ${event.datetime}

      Skapa en artikel som innehåller:
      1. En slagkraftig rubrik (title).
      2. En sammanfattande ingress (lead).
      3. En detaljerad brödtext (body).
      4. En passande kategori (category) t.ex. Blåljus, Brott, Trafikolycka.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            lead: { type: Type.STRING },
            body: { type: Type.STRING },
            category: { type: Type.STRING },
          },
          required: ["title", "lead", "body", "category"]
        },
      },
    });

    const result = JSON.parse(response.text || "{}");
    
    // Generate a random-ish placeholder image based on category
    const categoryQuery = result.category.toLowerCase();
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
