import { Controller, Get, Module, RequestMethod } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';

import { AppError } from '@vaidya/shared';

import { AppModule } from '../src/app.module';
import { Public } from '../src/common/decorators/public.decorator';

@Controller('__test__')
class TestErrorsController {
  @Public()
  @Get('app-error')
  throwAppError() {
    throw new AppError('VALIDATION_ERROR', 'Human readable message.', { field: 'name' });
  }

  @Public()
  @Get('slot-error')
  throwSlotError() {
    throw new AppError('SLOT_NOT_AVAILABLE', 'Selected slot is no longer available.', {
      slot_id: 'test-slot',
    });
  }
}

@Module({
  controllers: [TestErrorsController],
})
class TestSupportModule {}

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule, TestSupportModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'internal/(.*)', method: RequestMethod.ALL }],
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
