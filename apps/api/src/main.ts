import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { loadDotEnv, env } from './config/env';
import { AppModule } from './app.module';

loadDotEnv();

async function bootstrap() {
  // rawBody: necesario para verificar la firma del webhook de Stripe, que
  // debe validarse contra el Buffer crudo del body, no el JSON ya parseado.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  /**
   * Resolución de la IP real del cliente. Sin esto, detrás de un balanceador
   * todas las peticiones parecen venir de la misma IP interna y los límites
   * por IP (throttling, bloqueo de login) o bien no sirven de nada o bien
   * castigan a todos los usuarios a la vez. Con un número exacto de saltos,
   * Express toma la IP que insertó el proxy de confianza — un atacante NO
   * puede falsearla mandando su propio X-Forwarded-For.
   */
  app.set('trust proxy', env.trustProxyHops);

  // Cabeceras de seguridad. La API sirve JSON, no HTML: se desactiva la CSP
  // (no aplica) y se deja el resto — nosniff, frameguard, HSTS, referrer, y
  // el borrado de X-Powered-By, que deja de anunciar que esto es Express.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // Límite de tamaño del body: un POST de 100 MB consumiría memoria y CPU de
  // parseo antes de que ningún guard llegue a rechazarlo.
  app.useBodyParser('json', { limit: env.maxBodySize });
  app.useBodyParser('urlencoded', { limit: env.maxBodySize, extended: true });

  app.enableCors({
    origin: env.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400, // cachea el preflight 24 h: menos peticiones OPTIONS
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const server = await app.listen(env.apiPort);

  /**
   * Defensa contra slow-loris: conexiones que abren un socket y mandan la
   * petición byte a byte para agotar el pool de conexiones sin generar tráfico.
   * Node por defecto es demasiado permisivo con las cabeceras incompletas.
   */
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 30_000;
  server.maxHeadersCount = 100;

  Logger.log(`API escuchando en http://localhost:${env.apiPort}/api`, 'Bootstrap');
  if (env.isProduction && env.trustProxyHops === 0) {
    Logger.warn(
      'TRUST_PROXY_HOPS=0 en producción: los límites por IP verán la IP del proxy, no la del cliente.',
      'Bootstrap',
    );
  }
}

bootstrap();
