export function entryRoute(url, { development = false } = {}) {
  if (url.pathname === '/rastrear' || url.pathname.startsWith('/rastrear/')) {
    return {
      page: 'public-record',
      publicId: url.pathname === '/rastrear' ? '' : url.pathname.slice('/rastrear/'.length),
    };
  }

  if (url.pathname === '/app' || url.pathname === '/app/') {
    return { page: 'application' };
  }

  if (development && url.pathname === '/previa-rastreamento') {
    return { page: 'preview' };
  }

  // Preserve invitation and password-reset links sent before the entry moved.
  if (url.pathname === '/' && (url.searchParams.has('invite') || url.searchParams.has('token'))) {
    return { page: 'redirect', destination: `/app${url.search}` };
  }

  return { page: 'public-home' };
}
