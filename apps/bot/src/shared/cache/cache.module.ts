import { Global, Module } from '@spraxium/common';
import { CacheStoreService } from './cache-store.service';

/** Cache temps réel (ICacheStore) : Redis avec fallback mémoire auto. */
@Global()
@Module({
  providers: [CacheStoreService],
  exports: [CacheStoreService],
})
export class CacheModule {}
