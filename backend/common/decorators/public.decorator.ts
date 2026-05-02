import { SetMetadata } from '@nestjs/common';

// Key used by JwtAuthGuard to detect public routes
export const IS_PUBLIC_KEY = 'isPublic';

// Add @Public() above any controller method to skip JWT auth entirely.
// Example:
//   @Public()
//   @Get('github')
//   githubLogin() {}
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);