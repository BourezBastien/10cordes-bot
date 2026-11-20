import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { RecordsService } from './records.service';

// Store générique typé : collections Zod déclarées en code, tools records.*.
@Module({
  imports: [ToolRegistryModule],
  providers: [RecordsService],
})
export class RecordsModule {}
