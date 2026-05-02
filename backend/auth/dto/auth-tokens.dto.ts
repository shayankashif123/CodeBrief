import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensDto {
    @ApiProperty({ description: 'JWT access token — short lived (15 minutes)' })
    accessToken: string;

    @ApiProperty({ description: 'Refresh token — long lived (30 days)' })
    refreshToken: string;

    @ApiProperty({ description: 'Access token expiry in seconds' })
    expiresIn: number;
}

export class AuthUserDto {
    @ApiProperty()
    id: string;

    @ApiProperty()
    username: string;

    @ApiProperty()
    email: string;

    @ApiProperty({ nullable: true })
    avatarUrl: string | null;
}

export class AuthResponseDto {
    @ApiProperty({ type: AuthUserDto })
    user: AuthUserDto;

    @ApiProperty({ type: AuthTokensDto })
    tokens: AuthTokensDto;
}