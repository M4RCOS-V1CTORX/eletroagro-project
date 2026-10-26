import { randomUUID } from 'node:crypto';

export function requestDiagnostics(log = console.error) {
  return (request, response, next) => {
    const id = randomUUID(), started = performance.now();
    response.setHeader('X-Request-Id', id);
    response.on('finish', () => {
      if (response.statusCode < 500) return;
      log(JSON.stringify({ event: 'api_error', requestId: id, method: request.method,
        route: request.route?.path || 'unmatched', status: response.statusCode,
        durationMs: Math.round(performance.now() - started), at: new Date().toISOString() }));
    });
    next();
  };
}
