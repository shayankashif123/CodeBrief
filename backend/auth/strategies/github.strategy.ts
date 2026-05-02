import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { AuthService } from '../auth.service';

// What GitHub sends back after the user approves OAuth
interface GithubProfile {
    id: string;               // GitHub's numeric user ID — our stable identifier
    username: string;
    displayName: string;
    // emails can be empty if the user has set their email to private on GitHub
    emails?: Array<{ value: string; primary: boolean; verified: boolean }>;
    photos?: Array<{ value: string }>;
}

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor(
        private readonly configService: ConfigService,
        private readonly authService: AuthService,
    ) {
        super({
            clientID: configService.getOrThrow<string>('GITHUB_CLIENT_ID'),
            clientSecret: configService.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
            // Must match exactly what you set in GitHub OAuth App settings
            callbackURL: `${configService.getOrThrow<string>('BACKEND_URL')}/api/auth/github/callback`,
            // What we ask GitHub for — identity + email
            scope: ['user:email', 'read:user'],
        });
    }

    // Called automatically by Passport after GitHub redirects back
    // Whatever we return here gets attached to req.user
    async validate(
        _accessToken: string,
        _refreshToken: string,
        profile: GithubProfile,
    ) {
        // Pick the primary verified email, fall back to first available email,
        // fall back to null — never fabricate a fake email address.
        // GitHub users with private email settings return an empty array.
        const email: string | null =
            profile.emails?.find((e) => e.primary && e.verified)?.value ??
            profile.emails?.[0]?.value ??
            null;

        // Find or create the user in PostgreSQL
        const user = await this.authService.findOrCreateUser({
            githubId: profile.id,
            username: profile.username,
            email,
            avatarUrl: profile.photos?.[0]?.value ?? null,
        });

        return user;
    }
}