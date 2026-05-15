import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const IMAGES_DIR = path.join(__dirname, '..', 'interest-images');

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

async function main() {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;

  if (!bucket || !region) {
    throw new Error('AWS_S3_BUCKET and AWS_REGION must be set in environment');
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const prisma = new PrismaClient();

  try {
    const files = fs
      .readdirSync(IMAGES_DIR)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

    console.log(`Found ${files.length} image(s) in ${IMAGES_DIR}\n`);

    let uploaded = 0;
    let skipped = 0;

    for (const file of files) {
      const ext = path.extname(file).slice(1).toLowerCase();
      const slug = path.basename(file, path.extname(file));
      const contentType = MIME[ext] ?? 'application/octet-stream';

      const interest = await prisma.interest.findUnique({ where: { slug } });

      if (!interest) {
        console.warn(`  SKIP  "${file}" — no interest with slug "${slug}"`);
        skipped++;
        continue;
      }

      const key = `interests/${interest.id}/${slug}.${ext}`;
      const body = fs.readFileSync(path.join(IMAGES_DIR, file));

      process.stdout.write(`  UP    ${file} → ${key} ... `);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );

      await prisma.interest.update({
        where: { id: interest.id },
        data: { image: key },
      });

      console.log('✓');
      uploaded++;
    }

    console.log(`\nDone. ${uploaded} uploaded, ${skipped} skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
