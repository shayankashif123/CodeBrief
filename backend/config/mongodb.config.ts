import { ConfigService } from '@nestjs/config';
import { MongooseModuleOptions } from '@nestjs/mongoose';

export const getMongoConfig = (
  configService: ConfigService,
): MongooseModuleOptions => ({
  uri: configService.getOrThrow<string>('MONGO_URI'),
  // Production-ready defaults
  autoIndex: configService.get<string>('NODE_ENV') === 'development',
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});