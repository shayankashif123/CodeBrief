import { ConfigService } from '@nestjs/config';

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

export const getGithubConfig = (configService: ConfigService): GithubAppConfig => ({
  appId: configService.getOrThrow<string>('GITHUB_APP_ID'),
  // Private key comes in as a single-line env var with literal \n — restore newlines
  privateKey: configService
    .getOrThrow<string>('GITHUB_APP_PRIVATE_KEY')
    .replace(/\\n/g, '\n'),
  webhookSecret: configService.getOrThrow<string>('GITHUB_WEBHOOK_SECRET'),
  clientId: configService.getOrThrow<string>('GITHUB_CLIENT_ID'),
  clientSecret: configService.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
});