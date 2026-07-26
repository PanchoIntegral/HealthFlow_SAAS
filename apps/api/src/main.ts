import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { loadDotEnv, env } from './config/env';
import { AppModule } from './app.module';

loadDotEnv();

async function bootstrap() {
  // rawBody: necesario para verificar la firma del webhook de Stripe, que
  // debe validarse contra el Buffer crudo del body, no el JSON ya parseado.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.enableCors({ origin: env.webOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  await app.listen(env.apiPort);
  Logger.log(`API escuchando en http://localhost:${env.apiPort}/api`, 'Bootstrap');
}

bootstrap();
