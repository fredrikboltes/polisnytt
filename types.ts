
export interface PoliceEvent {
  id: number;
  datetime: string;
  name: string;
  summary: string;
  url: string;
  type: string;
  location: {
    name: string;
    gps: string;
  };
}

export interface NewsArticle {
  id: string;
  originalEventId: number;
  title: string;
  lead: string;
  body: string;
  category: string;
  location: string;
  timestamp: string;
  imageUrl: string;
}

export enum FetchStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error'
}

export const COUNTIES = [
  "Blekinge", "Dalarna", "Gotland", "Gävleborg", "Halland", 
  "Jämtland", "Jönköping", "Kalmar", "Kronoberg", "Norrbotten", 
  "Skåne", "Stockholm", "Södermanland", "Uppsala", "Värmland", 
  "Västerbotten", "Västernorrland", "Västmanland", "Västra Götaland", 
  "Örebro", "Östergötland"
];
