import { COUNTY_API_LOCATION_NAMES } from './services/policeLocation.mjs';

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

export const COUNTIES = Object.keys(COUNTY_API_LOCATION_NAMES);
