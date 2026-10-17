/**
 * S3 Audit Integration Examples
 *
 * This file shows how to integrate S3 audit logging into existing S3 operations.
 * Add these logging calls to your existing S3 service methods.
 */

import { createS3AuditMiddleware } from "./s3Audit";
import type { S3Operation } from "@/types/audit";
import { prop } from "./narrow";

const auditMiddleware = createS3AuditMiddleware();

type AuditMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
const AUDIT_METHODS: readonly AuditMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "HEAD",
];

/** Methods the audit table knows; anything else (PATCH, OPTIONS...) is logged as GET */
function toAuditMethod(method: string): AuditMethod {
  return AUDIT_METHODS.find((known) => known === method) ?? "GET";
}

/** Unset and empty both fall back to "unknown" */
function auditBucketName(): string {
  const bucket = process.env.B2_BUCKET_NAME;
  return bucket !== undefined && bucket !== "" ? bucket : "unknown";
}

/**
 * Example: Integrating audit logging into thumbnail API
 * Add this to your existing thumbnail route handler
 */
export async function auditThumbnailRequest(
  request: Request,
  photoId: string,
  startTime: number,
  statusCode: number,
  bytesTransferred?: number,
  error?: string,
  cacheHit?: boolean,
) {
  await auditMiddleware.log({
    operation: "GetObject",
    method: "GET",
    endpoint: `/api/photos/${photoId}/thumbnail`,
    bucket: auditBucketName(),
    key: `thumbnails/${photoId}`, // or actual S3 key
    startTime,
    statusCode,
    bytesTransferred,
    error,
    cacheHit,
    request,
  });
}

/**
 * Example: Integrating audit logging into folder listing
 */
export async function auditFolderListingRequest(
  request: Request,
  folderPath: string,
  startTime: number,
  statusCode: number,
  responseData?: unknown, // Pass the actual response data instead of just item count
  error?: string,
) {
  // Calculate actual response size if response data is provided
  let bytesTransferred: number | undefined;
  if (responseData) {
    bytesTransferred = JSON.stringify(responseData).length;
  }

  await auditMiddleware.log({
    operation: "ListObjects",
    method: "GET",
    endpoint: `/api/folders${folderPath ? `/${folderPath}` : ""}`,
    bucket: auditBucketName(),
    key: folderPath || undefined,
    startTime,
    statusCode,
    bytesTransferred,
    error,
    request,
  });
}

/**
 * Example: Integrating audit logging into photo download
 */
export async function auditPhotoDownloadRequest(
  request: Request,
  photoKey: string,
  startTime: number,
  statusCode: number,
  bytesTransferred?: number,
  error?: string,
) {
  await auditMiddleware.log({
    operation: "GetObject",
    method: "GET",
    endpoint: `/api/photos/download`,
    bucket: auditBucketName(),
    key: photoKey,
    startTime,
    statusCode,
    bytesTransferred,
    error,
    request,
  });
}

/**
 * Example: Integrating audit logging into bucket operations
 */
export async function auditBucketRequest(
  request: Request,
  operation: S3Operation,
  startTime: number,
  statusCode: number,
  error?: string,
) {
  await auditMiddleware.log({
    operation,
    method: "GET",
    endpoint: `/api/bucket`,
    bucket: auditBucketName(),
    startTime,
    statusCode,
    error,
    request,
  });
}

/**
 * Generic S3 operation audit wrapper
 * Use this to wrap any S3 SDK calls
 */
export async function auditS3Operation<T>(
  operation: S3Operation,
  bucket: string,
  key: string | undefined,
  request: Request | undefined,
  s3Operation: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  let statusCode = 200;
  let error: string | undefined;
  let bytesTransferred: number | undefined;

  try {
    const result = await s3Operation();

    // Extract bytes transferred if available
    const contentLength = prop(result, "ContentLength");
    if (typeof contentLength === "number") {
      bytesTransferred = contentLength;
    }
    const byteLength = prop(prop(result, "Body"), "byteLength");
    if (typeof byteLength === "number") {
      bytesTransferred = byteLength;
    }

    return result;
  } catch (err) {
    statusCode = 500;
    error = err instanceof Error ? err.message : "Unknown error";

    // Extract status code from AWS error if available
    const httpStatusCode = prop(prop(err, "$metadata"), "httpStatusCode");
    if (typeof httpStatusCode === "number" && httpStatusCode) {
      statusCode = httpStatusCode;
    }
    const errStatusCode = prop(err, "statusCode");
    if (typeof errStatusCode === "number") {
      statusCode = errStatusCode;
    }

    throw err;
  } finally {
    if (request) {
      await auditMiddleware.log({
        operation,
        method: toAuditMethod(request.method),
        endpoint: new URL(request.url).pathname,
        bucket,
        key,
        startTime,
        statusCode,
        bytesTransferred,
        error,
        request,
      });
    }
  }
}

/**
 * Cost estimation helpers
 * Add these to calculate estimated costs for S3 operations
 */
export function estimateS3Cost(
  operation: S3Operation,
  bytesTransferred?: number,
): number {
  // Basic cost estimation (adjust based on your AWS region and pricing)
  const costs: Partial<Record<S3Operation, number>> = {
    GetObject: 0.0004 / 1000, // $0.0004 per 1,000 requests
    ListObjects: 0.005 / 1000, // $0.005 per 1,000 requests
    ListBuckets: 0.0004 / 1000,
    PutObject: 0.005 / 1000, // $0.005 per 1,000 requests
    DeleteObject: 0.0004 / 1000,
    HeadObject: 0.0004 / 1000,
    GetBucketLocation: 0.0004 / 1000,
    GetObjectMetadata: 0.0004 / 1000,
    GeneratePresignedUrl: 0, // No cost for URL generation
    DownloadFile: 0.0004 / 1000,
    UploadFile: 0.005 / 1000,
    CreateMultipartUpload: 0.005 / 1000,
    UploadPart: 0.005 / 1000,
    CompleteMultipartUpload: 0.005 / 1000,
    AbortMultipartUpload: 0.0004 / 1000,
  };

  const requestCost = costs[operation] ?? 0;

  // Add data transfer costs if applicable
  let transferCost = 0;
  if (bytesTransferred && operation === "GetObject") {
    // First 1 GB free, then $0.09 per GB
    const gbTransferred = bytesTransferred / (1024 * 1024 * 1024);
    if (gbTransferred > 1) {
      transferCost = (gbTransferred - 1) * 0.09;
    }
  }

  return requestCost + transferCost;
}

/**
 * Example integration in existing API route
 *
 * // In your existing route handler:
 * export async function GET(request: Request, { params }: { params: { id: string } }) {
 *   const startTime = Date.now();
 *
 *   try {
 *     // Your existing logic here
 *     const photo = await getPhoto(params.id);
 *     const thumbnailData = await generateThumbnail(photo);
 *
 *     // Log successful request
 *     await auditThumbnailRequest(
 *       request,
 *       params.id,
 *       startTime,
 *       200,
 *       thumbnailData.length,
 *       undefined,
 *       false // or true if served from cache
 *     );
 *
 *     return new Response(thumbnailData, {
 *       headers: { 'Content-Type': 'image/jpeg' }
 *     });
 *
 *   } catch (error) {
 *     // Log error request
 *     await auditThumbnailRequest(
 *       request,
 *       params.id,
 *       startTime,
 *       500,
 *       undefined,
 *       error instanceof Error ? error.message : 'Unknown error'
 *     );
 *
 *     throw error;
 *   }
 * }
 */
