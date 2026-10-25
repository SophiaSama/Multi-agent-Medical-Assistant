// Server-side proxy for Google Places API (New).
//
// The Google Maps Platform key is read from GOOGLE_MAPS_PLATFORM_KEY on the
// server only and never shipped to the browser. The frontend calls the
// /api/places/* routes in server.ts, which delegate to the functions below.

const PLACES_BASE = 'https://places.googleapis.com/v1';

export class PlacesConfigError extends Error {}

function getKey(): string {
  const key = process.env.GOOGLE_MAPS_PLATFORM_KEY;
  if (!key) throw new PlacesConfigError('GOOGLE_MAPS_PLATFORM_KEY is not configured on the server');
  return key;
}

export function isPlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_PLATFORM_KEY);
}

async function placesPost<T>(path: string, body: unknown, fieldMask: string): Promise<T> {
  const res = await fetch(`${PLACES_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': getKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Log Google's error server-side; don't echo it (or the key) to the client.
    const text = await res.text().catch(() => '');
    console.error(`[Places] ${path} failed: ${res.status} ${text.slice(0, 500)}`);
    throw new Error(`Places request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export interface PlaceSuggestion {
  placeId: string;
  text: string;
  mainText?: string;
  secondaryText?: string;
}

export async function autocompletePlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const data = await placesPost<any>(
    '/places:autocomplete',
    { input, ...(sessionToken ? { sessionToken } : {}) },
    'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat',
  );
  return (data.suggestions ?? [])
    .map((s: any) => s.placePrediction)
    .filter((p: any) => p?.placeId && p?.text?.text)
    .map((p: any) => ({
      placeId: p.placeId,
      text: p.text.text,
      mainText: p.structuredFormat?.mainText?.text,
      secondaryText: p.structuredFormat?.secondaryText?.text,
    }));
}

export interface ClinicPlace {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingCount?: number;
  phone?: string;
  googleMapsUri?: string;
  openNow?: boolean;
}

export async function searchClinic(textQuery: string): Promise<ClinicPlace | null> {
  const data = await placesPost<any>(
    '/places:searchText',
    { textQuery, pageSize: 1 },
    [
      'places.displayName',
      'places.formattedAddress',
      'places.location',
      'places.rating',
      'places.userRatingCount',
      'places.nationalPhoneNumber',
      'places.googleMapsUri',
      'places.regularOpeningHours.openNow',
    ].join(','),
  );
  const p = data.places?.[0];
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  if (!p || typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    name: p.displayName?.text ?? textQuery,
    address: p.formattedAddress,
    lat,
    lng,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    phone: p.nationalPhoneNumber,
    googleMapsUri: p.googleMapsUri,
    openNow: typeof p.regularOpeningHours?.openNow === 'boolean' ? p.regularOpeningHours.openNow : undefined,
  };
}
