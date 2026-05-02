import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../auth.service';

export interface JwtRefreshPayload {
    sub: string;       // user UUID
    sessionId: string; // identifies which device/session this refresh token belongs to
    iat?: number;
    exp?: number;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
    constructor(
        private readonly configService: ConfigService,
        private readonly authService: AuthService,
    ) {
        super({
            // Extract refresh token from Authorization: Bearer <token> header
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
            // Pass the raw request so we can extract the token for Redis validation
            passReqToCallback: true,
        });
    }

    async validate(req: Request, payload: JwtRefreshPayload) {
        // Extract raw token from header
        const rawToken = req.headers.authorization?.split(' ')[1];

        if (!rawToken) {
            throw new UnauthorizedException('Refresh token missing');
        }

        // Validate token exists in Redis — this is how we detect revoked tokens.
        // If a user logs out, we delete the Redis key. Even if the JWT is still
        // cryptographically valid, it will be rejected here.
        const isValid = await this.authService.validateRefreshToken(
            payload.sub,
            payload.sessionId,
            rawToken,
        );

        if (!isValid) {
            throw new UnauthorizedException('Refresh token revoked or expired');
        }

        return { userId: payload.sub, sessionId: payload.sessionId };
    }
}