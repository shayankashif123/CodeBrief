import {
    Controller,
    Get,
    Post,
    Req,
    Res,
    UseGuards,
    HttpCode,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { User } from '@/repository/entities/user.entity';
import { AuthResponseDto } from './dto/auth-tokens.dto';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayload } from './strategies/jwt-refresh.strategy';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) { }

    // ─── Step 1: Initiate GitHub OAuth ───────────────────────────
    // User hits this endpoint → Passport redirects them to GitHub.
    // GitHub shows the consent screen → user approves → GitHub
    // redirects back to /callback with a temporary code.
    @Get('github')
    @Public()                    // no JWT required — this is the entry point
    @UseGuards(GithubAuthGuard)  // Passport handles the redirect
    @ApiOperation({ summary: 'Initiate GitHub OAuth login' })
    @ApiResponse({ status: 302, description: 'Redirects to GitHub OAuth' })
    githubLogin() {
        // Passport intercepts this and redirects to GitHub.
        // This function body never actually executes.
    }

    // ─── Step 2: GitHub OAuth Callback ───────────────────────────
    // GitHub redirects here after user approves.
    // GithubAuthGuard validates the code, GithubStrategy calls
    // findOrCreateUser, and the user object lands on req.user.
    // We then issue JWT tokens and redirect to the frontend.
    @Get('github/callback')
    @Public()
    @UseGuards(GithubAuthGuard)
    @ApiOperation({ summary: 'GitHub OAuth callback — handled automatically' })
    async githubCallback(
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const user = req.user as User;
        const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

        try {
            const authResponse = await this.authService.generateTokens(user);

            this.logger.log(`User authenticated: ${user.username}`);

            // Redirect to frontend with tokens as query params.
            // Frontend extracts them, stores in memory, and removes from URL.
            // In production consider using HttpOnly cookies instead.
            const params = new URLSearchParams({
                accessToken: authResponse.tokens.accessToken,
                refreshToken: authResponse.tokens.refreshToken,
                expiresIn: String(authResponse.tokens.expiresIn),
            });

            return res.redirect(`${frontendUrl}/auth/callback?${params.toString()}`);
        } catch (error) {
            this.logger.error('OAuth callback failed', error);
            return res.redirect(`${frontendUrl}/auth/error?reason=oauth_failed`);
        }
    }

    // ─── Step 3: Refresh Access Token ────────────────────────────
    // Called by the frontend when the access token expires (every 15m).
    // Send the refresh token in the Authorization header.
    // Returns a brand new access + refresh token pair (rotation).
    @Post('refresh')
    @Public()
    @UseGuards(JwtRefreshGuard)
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Rotate refresh token — get new access + refresh token pair' })
    @ApiResponse({ status: 200, type: AuthResponseDto })
    @ApiResponse({ status: 401, description: 'Invalid or revoked refresh token' })
    async refresh(@Req() req: Request): Promise<AuthResponseDto> {
        // JwtRefreshStrategy attaches { userId, sessionId } to req.user
        const { userId, sessionId } = req.user as { userId: string; sessionId: string };
        return this.authService.rotateRefreshToken(userId, sessionId);
    }

    // ─── Step 4a: Logout Current Session ─────────────────────────
    // Revokes only the current device's refresh token.
    // Access token is stateless — it expires naturally after 15 minutes.
    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Logout current session' })
    @ApiResponse({ status: 200, description: 'Logged out successfully' })
    async logout(@Req() req: Request): Promise<{ message: string }> {
        const user = req.user as User & { sessionId: string };
        await this.authService.logout(user.id, user.sessionId);
        return { message: 'Logged out successfully' };
    }

    // ─── Step 4b: Logout All Devices ─────────────────────────────
    // Revokes all refresh tokens for this user across all devices.
    @Post('logout/all')
    @UseGuards(JwtAuthGuard)
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Logout from all devices' })
    @ApiResponse({ status: 200, description: 'Logged out from all devices' })
    async logoutAll(@CurrentUser() user: User): Promise<{ message: string }> {
        await this.authService.logoutAllDevices(user.id);
        return { message: 'Logged out from all devices' };
    }

    // ─── Get Current User ─────────────────────────────────────────
    // Returns the authenticated user's profile.
    // Useful for frontend to populate the dashboard on load.
    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get current authenticated user' })
    @ApiResponse({ status: 200, description: 'Current user profile' })
    @ApiResponse({ status: 401, description: 'Not authenticated' })
    me(@CurrentUser() user: User) {
        return {
            id: user.id,
            username: user.username,
            email: user.email,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
        };
    }
}