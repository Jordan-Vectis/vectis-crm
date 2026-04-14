/**
 * Convert an R2 object key to a proxy URL.
 * - Internal (staff) pages: uses the authenticated /api/catalogue/photo-proxy
 * - Public pages: uses the unauthenticated /api/public/photo (lot-photos only)
 */
export function lotPhotoUrl(key: string | null | undefined, isPublic = false): string | null {
  if (!key) return null
  // Already a full URL (e.g. https://...)
  if (key.startsWith("http")) return key
  const endpoint = isPublic ? "/api/public/photo" : "/api/catalogue/photo-proxy"
  return `${endpoint}?key=${encodeURIComponent(key)}`
}
