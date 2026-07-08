import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context';
import { TenantDbService } from './tenant-db.service';

@Global()
@Module({
  providers: [RequestContextService, TenantDbService],
  exports: [RequestContextService, TenantDbService],
})
export class TenantContextModule {}
