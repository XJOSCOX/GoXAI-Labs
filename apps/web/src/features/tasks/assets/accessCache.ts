type AssetAccessSession = {
  user: {
    id: string;
  };
};

const assetAccessUrlCache = new Map<string, { accessUrl: string; expiresAt: number }>();

export function getAssetAccessCacheKey(session: AssetAccessSession, assetId: string) {
  return `${session.user.id}:${assetId}`;
}

export function getCachedAssetAccessUrl(cacheKey: string) {
  const cached = assetAccessUrlCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now() + 30_000) {
    assetAccessUrlCache.delete(cacheKey);
    return null;
  }

  return cached.accessUrl;
}

export function cacheAssetAccessUrl(cacheKey: string, accessUrl: string, expiresInSeconds: number) {
  assetAccessUrlCache.set(cacheKey, {
    accessUrl,
    expiresAt: Date.now() + expiresInSeconds * 1000
  });
}
