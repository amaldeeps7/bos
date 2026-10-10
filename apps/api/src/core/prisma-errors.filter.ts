import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

/**
 * A record that isn't there — including one that belongs to another organisation, which RLS and the
 * tenant filter make invisible — is a 404, never a 403 that would confirm it exists (spec §9).
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorsFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    let out: HttpException | Error = e;
    if (e.code === 'P2025' || e.code === 'P2001' || e.code === 'P2015') out = new NotFoundException('Not found');
    else if (e.code === 'P2002') out = new ConflictException('That already exists.');
    else if (e.code === 'P2003') out = new NotFoundException('A linked record wasn’t found');
    super.catch(out, host);
  }
}
