import { Controller, Get, Req, Inject } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

import { type AuthContext } from '@vaidya/shared';

import { AUTH_CONTEXT_KEY, getAuthContext } from '../../common/guards/auth.guard';

import { AuthService } from './auth.service';

@Controller('me')
export class MeController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  async getMe(@Req() request: FastifyRequest & { [AUTH_CONTEXT_KEY]?: AuthContext }) {
    const auth = getAuthContext(request);
    return this.authService.getMe(auth);
  }
}
