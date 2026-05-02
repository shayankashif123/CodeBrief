import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/repository/entities/user.entity';

// Shape of the data we put inside every JWT access token
export interface JwtPayload {
    sub: string;       // user's UUID — "subject" is the JWT standard field name
    username: string;
    email: string;
    iat?: number;      // issued at — added automatically by jsonwebtoken
    exp?: number;      // expires at — added automatically by jsonwebtoken
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {
        super({
            // Extract JWT from the Authorization: Bearer <token> header
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            // Reject expired tokens — never allow access with an expired token
            ignoreExpiration: false,
            secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
        });
    }

    // Called automatically after the token signature is verified
    // The payload is the decoded JWT body — what we put in when signing
    async validate(payload: JwtPayload) {
        const user = await this.userRepository.findOne({
            where: { id: payload.sub },
        });

        // If user was deleted after token was issued — reject
        if (!user) {
            throw new UnauthorizedException('User no longer exists');
        }

        // Whatever we return here is attached to req.user on every request
        return user;
    }
}