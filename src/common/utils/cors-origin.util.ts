/**
 * Resolves the CORS `origin` option for both the HTTP server (main.ts) and the
 * WebSocket gateways. Gateway `@WebSocketGateway({ cors })` decorators are
 * evaluated at module-load time, before Nest's DI container exists, so this
 * reads `process.env` directly rather than going through ConfigService.
 */
export function getCorsOrigin(): boolean | string[] {
  if (process.env.NODE_ENV !== 'production') return true;

  const defaultOrigins = [
    'https://app.meetday.ai',
    'https://meetday-frontend.vercel.app',
    'https://admin.meetday.ai',
    'https://meetday-admin.vercel.app',
  ];

  const envOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([...defaultOrigins, ...envOrigins]));
}
