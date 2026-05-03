import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Controller({
  path: '/',
  version: VERSION_NEUTRAL,
})
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly configService: ConfigService,
  ) { }

  @Get('health')
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async getReadiness() {
    const postgresHealthy = this.dataSource.isInitialized;
    const mongoHealthy = this.mongoConnection.readyState === 1; // 1 = Connected

    // Check if AI-service is reachable[cite: 14]
    let aiServiceHealthy = false;
    try {
      const response = await axios.get(`${this.configService.get('FASTAPI_URL')}/health`);
      aiServiceHealthy = response.status === 200;
    } catch {
      aiServiceHealthy = false;
    }

    const isHealthy = postgresHealthy && mongoHealthy && aiServiceHealthy;

    return {
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        postgres: postgresHealthy ? 'up' : 'down',
        mongodb: mongoHealthy ? 'up' : 'down',
        ai_service: aiServiceHealthy ? 'up' : 'down',
      },
    };
  }
}