import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.s3 = new S3Client({
      region: configService.get<string>('s3.region'),
      credentials: {
        accessKeyId: configService.get<string>('s3.accessKeyId'),
        secretAccessKey: configService.get<string>('s3.secretAccessKey'),
      },
    });
    this.bucket = configService.get<string>('s3.bucket');
  }

  getPresignedUploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
  }

  getPresignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }
}
