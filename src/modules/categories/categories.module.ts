import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, InternalApiKeyGuard],
})
export class CategoriesModule {}
