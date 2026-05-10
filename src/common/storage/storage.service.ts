import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { RedisService } from '../redis/redis.service';

const PRESIGN_TTL = 900; // 15 minutes
const PRESIGN_CACHE_TTL = 840; // cache for 14 min — always valid when served

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.s3 = new S3Client({
      region: configService.get<string>('s3.region'),
      credentials: {
        accessKeyId: configService.get<string>('s3.accessKeyId'),
        secretAccessKey: configService.get<string>('s3.secretAccessKey'),
      },
    });
    this.bucket = configService.get<string>('s3.bucket');
  }

  getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: PRESIGN_TTL },
    );
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const cacheKey = `presign:${key}`;
    const cached = await this.redis.get<string>(cacheKey);
    if (cached) return cached;

    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: PRESIGN_TTL },
    );
    await this.redis.set(cacheKey, url, PRESIGN_CACHE_TTL);
    return url;
  }
}
