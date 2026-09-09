import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OutboxService } from '../messaging/outbox.service';
import { BookingAdminController, PublicBookingController } from './booking.controller';
import { BookingServiceApp } from './booking.service';

@Module({imports:[AuthModule,MessagingModule],controllers:[PublicBookingController,BookingAdminController],providers:[BookingServiceApp,OutboxService]})
export class PublicBookingModule{}
