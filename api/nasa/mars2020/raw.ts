import type { Request, Response } from 'express';

export const config = { maxDuration: 30 };

const FALLBACK_IMAGE = {
  id: 'NLF_1042_0762939311_824ECM_N0510000AUT_04096_00_295J01',
  imageid: 'NLF_1042_0762939311_824ECM_N0510000AUT_04096_00_295J01',
  title: 'Perseverance Sol 1042 Navcam Left', sol: 1042, camera: 'NAVCAM_LEFT',
  cameraFullName: 'Perseverance Navigation Camera Left', dateUtc: '2024-01-26T14:22:18.000Z', dateMars: 'Sol 1042',
  thumbnailUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01042/ids/edr/browse/navcam/NLF_1042_0762939311_824ECM_N0510000AUT_04096_00_295J01_800.jpg',
  fullResUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01042/ids/edr/browse/navcam/NLF_1042_0762939311_824ECM_N0510000AUT_04096_00_295J01.png',
  sourceUrl: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/NLF_1042_0762939311_824ECM_N0510000AUT_04096_00_295J01',
  site: 51, drive: 4096, credit: 'NASA/JPL-Caltech', mission: 'Mars 2020 (Perseverance)', targetRegion: 'Jezero Crater Delta Margin',
};

function normalizeImages(rawImages: any[], category: 'mars2020' | 'msl', fallbackSol?: string) {
  const seen = new Set<string>();
  return rawImages.flatMap((image, index) => {
    const id = image.imageid || `image_${image.sol || fallbackSol || 'unknown'}_${index}`;
    const thumbnailUrl = image.image_files?.medium || image.image_files?.small || image.image_files?.full_res || '';
    const fullResUrl = image.image_files?.full_res || image.image_files?.large || thumbnailUrl;
    if (!thumbnailUrl || seen.has(id)) return [];
    seen.add(id);
    const isMsl = category === 'msl';
    const camera = image.camera?.instrument || image.instrument || (isMsl ? 'Curiosity Mastcam' : 'Perseverance Navcam');
    return [{
      id, imageid: image.imageid || id,
      title: image.title || `${isMsl ? 'Curiosity' : 'Perseverance'} Sol ${image.sol} (${camera})`,
      sol: image.sol ?? Number(fallbackSol || 0), camera,
      cameraFullName: image.caption || `${isMsl ? 'Curiosity (MSL)' : 'Perseverance (Mars 2020)'} ${camera} frame`,
      dateUtc: image.date_taken_utc || image.date_received || new Date().toISOString(),
      dateMars: image.date_taken_mars || `Sol ${image.sol}`, thumbnailUrl, fullResUrl,
      sourceUrl: image.link || `https://mars.nasa.gov/${category}/multimedia/raw-images/${id}`,
      attitude: image.attitude || null, extended: image.extended || null, site: image.site ?? null, drive: image.drive ?? null,
      credit: image.credit || 'NASA/JPL-Caltech', mission: isMsl ? 'MSL (Curiosity)' : 'Mars 2020 (Perseverance)',
      targetRegion: isMsl ? 'Gale Crater (Mount Sharp)' : 'Jezero Crater',
    }];
  });
}

// Self-contained function: importing server.ts in Vercel also imports Vite and
// the entire application, which can crash before this route is invoked.
export default async function handler(req: Request, res: Response) {
  const mission = req.query.mission === 'msl' ? 'msl' : 'mars2020';
  const requestedSol = typeof req.query.sol === 'string' && req.query.sol !== 'latest' ? req.query.sol : undefined;
  const order = req.query.order === 'oldest' ? 'oldest' : 'newest';
  const num = Math.min(Math.max(Number(req.query.num) || 24, 1), 100);
  const params = new URLSearchParams({ feed: 'raw_images', category: mission, feedtype: 'json', num: String(num), page: String(req.query.page || 0), order: order === 'oldest' ? 'sol asc' : 'sol desc', search: '' });
  if (requestedSol) params.set('sol', requestedSol);
  if (typeof req.query.camera === 'string' && !/^all$/i.test(req.query.camera)) params.set('camera', req.query.camera);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const upstream = await fetch(`https://mars.nasa.gov/rss/api/?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Referer: 'https://mars.nasa.gov/', 'User-Agent': 'MarsNav NASA image proxy' },
    });
    clearTimeout(timeout);
    const contentType = upstream.headers.get('content-type') || '';
    const body = await upstream.text();
    if (!upstream.ok) throw new Error(`NASA JPL returned HTTP ${upstream.status}`);
    if (!contentType.includes('application/json')) throw new Error('NASA JPL returned HTML instead of its JSON feed');
    const data = JSON.parse(body);
    const images = normalizeImages(data.images || [], mission, requestedSol);
    return res.status(200).json({ images, totalResults: data.total_results || images.length, totalImages: data.total_images || data.total_results || images.length, sol: data.images?.[0]?.sol ?? Number(requestedSol || 0), latestObservationDate: data.images?.[0]?.date_taken_utc || new Date().toISOString(), mission, order, isStale: false, retrievedAt: new Date().toISOString() });
  } catch (error: any) {
    // An upstream outage still produces JSON, never Vercel's HTML error page.
    const images = mission === 'mars2020' ? [FALLBACK_IMAGE] : [];
    return res.status(200).json({ images, totalResults: images.length, totalImages: images.length, sol: FALLBACK_IMAGE.sol, latestObservationDate: FALLBACK_IMAGE.dateUtc, mission, order, isStale: true, retrievedAt: new Date().toISOString(), errorMessage: `Live NASA feed unavailable: ${error.message}` });
  }
}
