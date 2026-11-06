import { PUBLIC_SITE_ORIGIN } from '../../../../shared/public-site.js';

export function createCorsOptions(allowedOrigins) {
  return (request, callback) => {
    const origin = request.get('origin');
    const isPublicLookup = /^\/api\/public\/traceability(?:\/|$)/i.test(request.path);
    const isPublicSite = origin === PUBLIC_SITE_ORIGIN;
    const allowed = !origin
      || allowedOrigins.has(origin)
      || origin === 'http://localhost:5173'
      || (isPublicSite && isPublicLookup);

    const options = { origin: allowed };
    if (isPublicSite) options.methods = ['GET', 'HEAD', 'OPTIONS'];
    callback(null, options);
  };
}
