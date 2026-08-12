import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context';
import { TenantDbService } from './tenant-db.service';
import { SystemContextRunner } from './system-context.runner';

@Global()
@Module({
  providers: [RequestContextService, TenantDbService, SystemContextRunner],
  exports: [RequestContextService, TenantDbService, SystemContextRunner],
})
export class TenantContextModule {}
