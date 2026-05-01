import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from '@/config/database.config'; // Best practice: Use the constant we defined earlier

@Global() // 1. The Key Update
@Module({
  imports: [
    TypeOrmModule.forFeature(ENTITIES), // 2. Use the central list[cite: 3]
  ],
  exports: [TypeOrmModule], // 3. Re-export so repositories are available globally[cite: 2]
})
export class RepositoryModule {}