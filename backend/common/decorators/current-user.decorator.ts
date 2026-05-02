import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@/repository/entities/user.entity';

// Extracts the authenticated user from req.user cleanly in any controller.
//
// Usage:
//   @Get('me')
//   getMe(@CurrentUser() user: User) {
//     return user;
//   }
//
// Instead of the verbose:
//   @Get('me')
//   getMe(@Req() req: Request) {
//     return req.user;
//   }
export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): User => {
        const request = ctx.switchToHttp().getRequest();
        return request.user;
    },
);