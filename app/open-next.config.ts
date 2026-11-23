import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Pages Next.js prerenders at build time (static, no revalidation) are served from the build
// output instead of being re-rendered on every request. Cache interception serves them before
// the Next.js server is loaded. Dynamic routes (all /api/* routes) are not affected.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
