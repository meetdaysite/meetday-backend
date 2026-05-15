import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Reviews')
@ApiBearerAuth('firebase-token')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('highlights')
  @Public()
  @ApiOperation({ summary: 'Get available review highlights for an event' })
  @ApiQuery({ name: 'eventId', type: String })
  getHighlights(@Query('eventId', ParseUUIDPipe) eventId: string) {
    return this.reviewsService.getHighlightsForEvent(eventId);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('USER')
  @ApiOperation({ summary: 'Submit a review for an attended event' })
  createReview(@GetUser('id') userId: string, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createReview(userId, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my submitted reviews' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getMyReviews(
    @GetUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.reviewsService.getMyReviews(userId, page, limit);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update my review' })
  @ApiParam({ name: 'id', type: String })
  updateReview(
    @Param('id', ParseUUIDPipe) reviewId: string,
    @GetUser('id') userId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.updateReview(reviewId, userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete my review' })
  @ApiParam({ name: 'id', type: String })
  deleteReview(
    @Param('id', ParseUUIDPipe) reviewId: string,
    @GetUser('id') userId: string,
  ) {
    return this.reviewsService.deleteReview(reviewId, userId);
  }

  // ─── Host: photo moderation ───────────────────────────────────────────────

  @Get('host/photos/pending')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'List pending review photos for your events' })
  getPendingPhotos(@GetUser('id') userId: string) {
    return this.reviewsService.getPendingPhotos(userId);
  }

  @Patch('host/photos/:photoId')
  @UseGuards(RolesGuard)
  @Roles('HOST')
  @ApiOperation({ summary: 'Approve or reject a review photo' })
  @ApiParam({ name: 'photoId', type: String })
  moderatePhoto(
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @GetUser('id') userId: string,
    @Body('action') action: 'APPROVED' | 'REJECTED',
  ) {
    return this.reviewsService.moderatePhoto(photoId, userId, action);
  }
}
