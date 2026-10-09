import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const PERMS = 'perms';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires every listed permission (and the module each belongs to must be on). */
export const Perm = (...perms: string[]) => SetMetadata(PERMS, perms);
export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
