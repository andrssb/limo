import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const s3 = new S3Client({
  endpoint: config.STORAGE_ENDPOINT,
  region: config.STORAGE_REGION,
  credentials: {
    accessKeyId: config.STORAGE_ACCESS_KEY,
    secretAccessKey: config.STORAGE_SECRET_KEY,
  },
  forcePathStyle: true,
});

export async function uploadAudio(key: string, body: Buffer, contentType: string): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${config.STORAGE_ENDPOINT}/${config.STORAGE_BUCKET}/${key}`;
}

export async function getAudioSignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }),
    { expiresIn }
  );
}

export async function deleteAudio(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: key }));
}

export function keyFromUrl(url: string): string {
  const parts = url.split(`/${config.STORAGE_BUCKET}/`);
  return parts[1] ?? url;
}
