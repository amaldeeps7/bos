import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

const origins = () => (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()).filter(Boolean);

/** Refuses to start in production with a guessable session-signing secret (the sample deployment only warns). */
function checkSecrets() {
  const s = process.env.JWT_SECRET || '';
  const weak = s.length < 32 || /change-me|dev-secret|secret/i.test(s);
  if (process.env.NODE_ENV !== 'production' || !weak) return;
  const msg = 'JWT_SECRET is missing or weak. Set a random value of at least 32 characters (e.g. `openssl rand -hex 32`).';
  if (process.env.DEMO_MODE === 'true') console.warn(`WARNING: ${msg} Allowed only because DEMO_MODE=true.`);
  else throw new Error(msg);
}

/**
 * Cross-site request check: a browser always sends Origin on POST/PATCH/PUT/DELETE, so a state-changing request
 * from another site is refused even though SameSite=Lax cookies would mostly stop it already. Requests without
 * Origin (server-to-server with a Bearer token, curl) aren't browser requests and pass.
 */
function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  // Same site as the page that sent it: one of WEB_ORIGIN, or the host the browser used (the web app proxies /api).
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  let from = ''; try { from = new URL(origin || '').host; } catch { /* malformed: refused below */ }
  if (!origin || origins().includes(origin) || (host && from === host)) return next();
  res.status(403).json({ statusCode: 403, message: 'Request refused: it came from another website.' });
}

/** Middleware and settings shared by the server and the tests. */
export function configureApp(app: NestExpressApplication) {
  // Behind a load balancer or the web app's proxy, use the client's address (rate limits, logs). TRUST_PROXY = number of proxy hops.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.setGlobalPrefix('api');
  // Security headers. JSON responses get a deny-all content policy; PDFs and export downloads skip it so the browser's
  // PDF viewer isn't blocked (they're files, not pages that could run script).
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  const csp = helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } });
  app.use((req: Request, res: Response, next: NextFunction) => (/\/pdf$|^\/api\/exports\//.test(req.path) ? next() : csp(req, res, next)));
  app.use(sameOrigin);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: origins(), credentials: true });
  return app;
}

async function bootstrap() {
  checkSecrets();
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`Business OS API on :${port}`);
}
if (require.main === module) bootstrap();
