import { Module } from '@nestjs/common';
import { env } from '../../config/env';
import { OutboxService } from './outbox.service';
import { FakeMessagingProvider, LiveMessagingProvider } from './providers';
import { MessagingWorker } from './worker.service';
import { MESSAGE_SCHEDULER, MESSAGING_PROVIDER } from './messaging.types';
import { MessagingAdminController, MessagingWebhookController } from './messaging.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../../common/audit/audit.module';

@Module({
  imports:[AuthModule,AuditModule],
  controllers:[MessagingWebhookController,MessagingAdminController],
  providers:[OutboxService,MessagingWorker,FakeMessagingProvider,LiveMessagingProvider,
    {provide:MESSAGE_SCHEDULER,useExisting:OutboxService},
    {provide:MESSAGING_PROVIDER,useFactory:(fake:FakeMessagingProvider,live:LiveMessagingProvider)=>env.messagingProvider==='fake'?fake:live,inject:[FakeMessagingProvider,LiveMessagingProvider]}],
  exports:[MESSAGE_SCHEDULER,MessagingWorker],
})
export class MessagingModule{}
