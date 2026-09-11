import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env, loadDotEnv } from './config/env';
import { MessagingWorker } from './modules/messaging/worker.service';
import { AppEventsDispatcher } from './common/events/app-events.dispatcher';

loadDotEnv();
// DrizzleModule se construye al crear el contexto, después de esta asignación.
// El worker jamás reutiliza DB_ADMIN_URL ni las credenciales amplias del API.
process.env.DATABASE_URL = env.workerDatabaseUrl;

async function bootstrap():Promise<void>{
  const app=await NestFactory.createApplicationContext(AppModule,{logger:['error','warn','log']});
  const worker=app.get(MessagingWorker);
  // Mismo proceso, misma vuelta: los eventos internos no justifican otro
  // despliegue. Van en try/catch separados para que un consumidor roto no
  // detenga la entrega de mensajes al paciente, ni al revés.
  const eventos=app.get(AppEventsDispatcher);
  let stopping=false;
  const stop=async()=>{ if(stopping)return; stopping=true; await app.close(); process.exit(0); };
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
  Logger.log('Worker de mensajería iniciado','MessagingWorker');
  while(!stopping){
    try { const count=await worker.tick(); if(count>0) Logger.log(`${count} mensaje(s) procesado(s)`,'MessagingWorker'); }
    catch(error){ Logger.error(error instanceof Error?error.message:'Error de worker','MessagingWorker'); }
    try { const count=await eventos.tick(); if(count>0) Logger.log(`${count} evento(s) interno(s) entregado(s)`,'AppEventsDispatcher'); }
    catch(error){ Logger.error(error instanceof Error?error.message:'Error de despacho','AppEventsDispatcher'); }
    await new Promise(resolve=>setTimeout(resolve,env.workerPollMs));
  }
}
void bootstrap();
