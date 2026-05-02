import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Applied to GET /api/auth/github/callback
// Triggers the GithubStrategy.validate() method automatically
@Injectable()
export class GithubAuthGuard extends AuthGuard('github') { }