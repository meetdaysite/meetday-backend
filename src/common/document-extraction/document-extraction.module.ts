import { Module } from '@nestjs/common';
import { DocumentExtractionService } from './document-extraction.service';

@Module({
  providers: [DocumentExtractionService],
  exports: [DocumentExtractionService],
})
export class DocumentExtractionModule {}
