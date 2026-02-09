/**
 * Cloudflare Cache Service
 * Handles caching of file chunks for streaming
 */

const CACHE_TTL = 60 * 60 * 24; // 24 hours

/**
 * Generate cache key for a file chunk
 */
export function getCacheKey(file_id: string, chunk_index: number, range?: { start: number; end: number }): string {
  if (range) {
    return `file:${file_id}:chunk:${chunk_index}:range:${range.start}-${range.end}`;
  }
  return `file:${file_id}:chunk:${chunk_index}`;
}

/**
 * Get cached response from Cloudflare Cache
 */
export async function getCached(cacheKey: string, cache: Cache | undefined): Promise<Response | null> {
  if (!cache) {
    return null; // No cache available (local dev)
  }

  try {
    const cached = await cache.match(cacheKey);
    return cached || null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * Store response in Cloudflare Cache
 */
export async function setCached(
  cacheKey: string,
  response: Response,
  cache: Cache | undefined,
  ttl: number = CACHE_TTL
): Promise<void> {
  if (!cache) {
    return; // No cache available
  }

  try {
    // Clone response for caching (original can be consumed)
    const responseToCache = response.clone();
    
    // Create new response with cache headers
    const headers = new Headers(responseToCache.headers);
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.set('X-Cache-Key', cacheKey);

    const cachedResponse = new Response(responseToCache.body, {
      status: responseToCache.status,
      statusText: responseToCache.statusText,
      headers,
    });

    // Store in cache
    await cache.put(cacheKey, cachedResponse);
  } catch (error) {
    console.error('Cache set error:', error);
    // Don't throw - caching is optional
  }
}

/**
 * Check if response should be cached
 */
export function shouldCache(mimeType: string | null): boolean {
  if (!mimeType) return false;
  
  // Cache video, image, audio files
  return (
    mimeType.startsWith('video/') ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/')
  );
}
