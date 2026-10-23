const neonAuthBaseUrl = 'https://ep-flat-sky-b6ju7s7a.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const hopByHopHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
]);

function getRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  if (request.body === undefined || request.body === null) return undefined;
  if (Buffer.isBuffer(request.body) || typeof request.body === 'string') return request.body;
  return JSON.stringify(request.body);
}

export default async function handler(request, response) {
  const pathParts = Array.isArray(request.query.path)
    ? request.query.path
    : request.query.path ? [request.query.path] : [];
  const targetUrl = new URL(`${neonAuthBaseUrl}/${pathParts.map(encodeURIComponent).join('/')}`);
  const queryIndex = request.url.indexOf('?');
  if (queryIndex !== -1) targetUrl.search = request.url.slice(queryIndex);

  const requestHeaders = new Headers(request.headers);
  for (const header of hopByHopHeaders) requestHeaders.delete(header);

  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: requestHeaders,
      body: getRequestBody(request),
      redirect: 'manual',
    });

    response.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (!hopByHopHeaders.has(name.toLowerCase()) && name.toLowerCase() !== 'set-cookie') {
        response.setHeader(name, value);
      }
    });

    const cookies = upstream.headers.getSetCookie?.() || [];
    if (cookies.length) {
      response.setHeader('set-cookie', cookies.map((cookie) =>
        cookie.replace(/;\s*domain=[^;]+/ig, ''),
      ));
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    return response.end(body);
  } catch (error) {
    console.error('Falha no proxy do Neon Auth:', error.message);
    return response.status(502).json({ error: 'Não foi possível conectar ao serviço de autenticação.' });
  }
}
