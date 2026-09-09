import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AvailabilitySlot, BookingService, BookingSettings, PublicAppointmentSummary, PublicBookingPage, PublicDirectoryPage } from '@healthflow/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard, RequirePolicy } from '../auth/casl/policies.guard';
import { BookingServiceApp } from './booking.service';
import { AvailabilityExceptionDto, CreatePublicAppointmentDto, PublicDirectoryQueryDto, ReplaceAvailabilityDto, ReschedulePublicAppointmentDto, UpdateBookingSettingsDto, UpsertBookingServiceDto } from './booking.dto';

@Controller('public')
export class PublicBookingController {
  constructor(private readonly booking:BookingServiceApp){}

  @Get('directory') @Throttle({default:{limit:30,ttl:60000},burst:{limit:5,ttl:1000}})
  directory(@Query() query:PublicDirectoryQueryDto):Promise<PublicDirectoryPage>{return this.booking.directory(query.q,query.page,query.pageSize);}

  @Get('booking/:slug') @Throttle({default:{limit:60,ttl:60000},burst:{limit:10,ttl:1000}})
  page(@Param('slug') slug:string):Promise<PublicBookingPage>{return this.booking.publicPage(slug);}

  @Get('booking/:slug/availability') @Throttle({default:{limit:30,ttl:60000},burst:{limit:5,ttl:1000}})
  availability(@Param('slug')slug:string,@Query('serviceId')serviceId?:string,@Query('doctorId')doctorId?:string,@Query('from')from?:string,@Query('to')to?:string):Promise<AvailabilitySlot[]>{if(!serviceId||!from||!to)throw new BadRequestException('serviceId, from y to son requeridos');return this.booking.availability(slug,serviceId,doctorId,from,to);}

  @Post('booking/:slug/appointments') @Throttle({default:{limit:8,ttl:60000},burst:{limit:2,ttl:1000}})
  create(@Param('slug')slug:string,@Body()dto:CreatePublicAppointmentDto):Promise<PublicAppointmentSummary>{return this.booking.create(slug,dto);}

  @Get('appointments/:token') @Throttle({default:{limit:30,ttl:60000},burst:{limit:5,ttl:1000}})
  get(@Param('token')token:string):Promise<PublicAppointmentSummary>{return this.booking.getAppointment(token);}

  @Post('appointments/:token/confirm') @Throttle({default:{limit:10,ttl:60000}})
  confirm(@Param('token')token:string):Promise<PublicAppointmentSummary>{return this.booking.confirm(token);}

  @Post('appointments/:token/cancel') @Throttle({default:{limit:10,ttl:60000}})
  cancel(@Param('token')token:string):Promise<PublicAppointmentSummary>{return this.booking.cancel(token);}

  @Post('appointments/:token/reschedule') @Throttle({default:{limit:10,ttl:60000}})
  reschedule(@Param('token')token:string,@Body()dto:ReschedulePublicAppointmentDto):Promise<PublicAppointmentSummary>{return this.booking.reschedule(token,dto.start,dto.doctorId);}
}

@Controller('booking')
@UseGuards(JwtAuthGuard,PoliciesGuard)
export class BookingAdminController {
  constructor(private readonly booking:BookingServiceApp){}
  @Get('settings') @RequirePolicy('manage','all') settings():Promise<BookingSettings>{return this.booking.getSettings();}
  @Put('settings') @RequirePolicy('manage','all') updateSettings(@Body()dto:UpdateBookingSettingsDto):Promise<BookingSettings>{return this.booking.updateSettings(dto);}
  @Get('services') @RequirePolicy('manage','all') services():Promise<BookingService[]>{return this.booking.listServices();}
  @Post('services') @RequirePolicy('manage','all') createService(@Body()dto:UpsertBookingServiceDto):Promise<BookingService>{return this.booking.createService(dto);}
  @Put('services/:id') @RequirePolicy('manage','all') updateService(@Param('id')id:string,@Body()dto:UpsertBookingServiceDto):Promise<BookingService>{return this.booking.updateService(id,dto);}
  @Delete('services/:id') @RequirePolicy('manage','all') async deleteService(@Param('id')id:string):Promise<BookingService>{const all=await this.booking.listServices(),item=all.find(x=>x.id===id);if(!item)throw new BadRequestException('Servicio no encontrado');return this.booking.updateService(id,{...item,activo:false,publico:false});}
  @Get('availability') @RequirePolicy('manage','all') availability():Promise<unknown[]>{return this.booking.listAvailabilityRules();}
  @Put('doctors/:doctorId/availability') @RequirePolicy('manage','all') async replace(@Param('doctorId')doctorId:string,@Body()dto:ReplaceAvailabilityDto):Promise<{ok:true}>{await this.booking.replaceAvailability(doctorId,dto.rules);return{ok:true};}
  @Post('exceptions') @RequirePolicy('manage','all') exception(@Body()dto:AvailabilityExceptionDto):Promise<unknown>{return this.booking.addException(dto);}
}
