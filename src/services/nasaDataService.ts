/**
 * NASA & PDS Data Service Layer
 * Authoritative data-access client for live Mars raw imagery, PDS HiRISE DTMs,
 * and data-source health monitoring with caching, cancellation, and error handling.
 */

export interface MarsRawImage {
  id: string;
  imageid: string;
  title: string;
  sol: number;
  camera: string;
  cameraFullName: string;
  dateUtc: string;
  dateMars: string;
  thumbnailUrl: string;
  fullResUrl: string;
  sourceUrl: string;
  attitude?: string;
  extended?: {
    mastAz?: string;
    mastEl?: string;
    dimension?: string;
    scaleFactor?: string;
    xyz?: string;
  };
  site?: number;
  drive?: string | number;
  credit: string;
  mission: 'Mars 2020 (Perseverance)' | 'MSL (Curiosity)';
  targetRegion: string;
  isStale?: boolean;
}

export interface HiRISEProduct {
  id: string;
  productType: 'DTM' | 'Orbital Imagery' | 'Stereo Pair';
  title: string;
  observationId: string;
  dtmProductId?: string;
  targetFeature: string;
  centerLatitude: number;
  centerLongitude: number;
  elevationMinM?: number;
  elevationMaxM?: number;
  spatialResolution: string;
  datum: string;
  acquisitionDate: string;
  thumbnailUrl: string;
  pdsUrl: string;
  description: string;
  sourceOrg: string;
  provenance: string;
}

export interface DataSourceHealth {
  sourceName: string;
  endpointUrl: string;
  status: 'connected' | 'degraded' | 'offline';
  latencyMs: number | null;
  lastSuccessfulUpdate: string | null;
  errorMessage?: string | null;
  cachedEntriesCount?: number;
}

export interface FetchRawImagesParams {
  mission?: 'mars2020' | 'msl';
  camera?: string;
  sol?: number | string;
  order?: 'newest' | 'oldest';
  fromSol?: number;
  toSol?: number;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  page?: number;
  signal?: AbortSignal;
}

export interface SyncLatestResult {
  status: 'success' | 'fallback';
  mission: 'mars2020' | 'msl';
  latestSol: number;
  latestObservationDate: string;
  latestImageId: string;
  latestCamera: string;
  totalObservations: number;
  totalImagesArchive: number;
  lastCheckedAt: string;
  source: string;
}

// In-memory client cache with 5-minute TTL
interface CacheItem<T> {
  data: T;
  timestamp: number;
}
const clientCache = new Map<string, CacheItem<any>>();
const CACHE_TTL_MS = 3 * 60 * 1000;

function getFromCache<T>(key: string): T | null {
  const item = clientCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    clientCache.delete(key);
    return null;
  }
  return item.data;
}

function saveToCache<T>(key: string, data: T) {
  clientCache.set(key, { data, timestamp: Date.now() });
}

/**
 * API requests should always return JSON. If a deployment rewrites a missing
 * API route to the SPA entry point, the response is HTML ("<!doctype ..."),
 * which used to surface as an unhelpful JSON parsing exception.
 */
async function readApiJson<T>(res: Response, endpoint: string): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();

  if (!res.ok) {
    throw new Error(`${endpoint} failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 240)}` : ''}`);
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    const isHtml = /^\s*<!doctype html|^\s*<html/i.test(body);
    throw new Error(
      isHtml
        ? `${endpoint} returned the website HTML instead of JSON. The API route is not deployed or is being rewritten to index.html.`
        : `${endpoint} returned an unexpected ${contentType || 'response'} instead of JSON.`
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${endpoint} returned malformed JSON.`);
  }
}

/**
 * Check and synchronize latest NASA Mars rover observations
 */
export async function syncLatestObservation(mission: 'mars2020' | 'msl' = 'mars2020'): Promise<SyncLatestResult> {
  const res = await fetch(`/api/nasa/sync/latest?mission=${mission}`);
  return readApiJson<SyncLatestResult>(res, 'NASA latest-observation API');
}

/**
 * Fetch raw rover images from NASA JPL Mars Raw Feed with sorting, full timeline & deduplication
 */
export async function fetchMarsRawImages(params: FetchRawImagesParams = {}): Promise<{
  images: MarsRawImage[];
  totalResults: number;
  totalImages?: number;
  sol: number;
  latestObservationDate?: string;
  order?: 'newest' | 'oldest';
  mission?: string;
  isStale: boolean;
  retrievedAt: string;
}> {
  const {
    mission = 'mars2020',
    camera,
    sol,
    order = 'newest',
    limit = 24,
    page = 0,
    signal
  } = params;
  const cacheKey = `raw_${mission}_${camera || 'all'}_${sol || 'latest'}_${order}_${limit}_${page}`;
  
  const cached = getFromCache<any>(cacheKey);
  if (cached) {
    return { ...cached, isStale: true };
  }

  const queryParams = new URLSearchParams();
  queryParams.set('mission', mission);
  queryParams.set('num', String(limit));
  queryParams.set('page', String(page));
  queryParams.set('order', order);
  if (camera && camera !== 'ALL' && camera !== 'all') queryParams.set('camera', camera);
  if (sol !== undefined && sol !== 'latest') queryParams.set('sol', String(sol));

  try {
    const res = await fetch(`/api/nasa/mars2020/raw?${queryParams.toString()}`, { signal });
    const data = await readApiJson<any>(res, 'NASA raw-images API');
    saveToCache(cacheKey, data);
    return data;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    const stale = clientCache.get(cacheKey)?.data;
    if (stale) {
      return { ...stale, isStale: true };
    }
    throw err;
  }
}

/**
 * Fetch real HiRISE orbital and digital elevation products from NASA & PDS
 */
export async function fetchHiRISEProducts(query?: string): Promise<{
  products: HiRISEProduct[];
  retrievedAt: string;
}> {
  const cacheKey = `hirise_${query || 'all'}`;
  const cached = getFromCache<any>(cacheKey);
  if (cached) return cached;

  const res = await fetch(`/api/nasa/hirise/products${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const data = await readApiJson<{ products: HiRISEProduct[]; retrievedAt: string }>(res, 'NASA HiRISE API');
  saveToCache(cacheKey, data);
  return data;
}

/**
 * Fetch real-time health and connectivity metrics for all Mars data sources
 */
export async function fetchSourcesHealth(): Promise<{
  sources: DataSourceHealth[];
  overallStatus: 'connected' | 'degraded' | 'offline';
  timestamp: string;
}> {
  try {
    const res = await fetch('/api/sources/health');
    return await readApiJson<{ sources: DataSourceHealth[]; overallStatus: 'connected' | 'degraded' | 'offline'; timestamp: string }>(res, 'NASA source-health API');
  } catch (err: any) {
    return {
      sources: [
        {
          sourceName: 'NASA Mars 2020 Raw Feed (JPL)',
          endpointUrl: 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020',
          status: 'offline',
          latencyMs: null,
          lastSuccessfulUpdate: null,
          errorMessage: err.message
        },
        {
          sourceName: 'NASA Planetary Data System (PDS Geosciences)',
          endpointUrl: 'https://pds-geosciences.wustl.edu/',
          status: 'offline',
          latencyMs: null,
          lastSuccessfulUpdate: null,
          errorMessage: err.message
        }
      ],
      overallStatus: 'offline',
      timestamp: new Date().toISOString()
    };
  }
}
