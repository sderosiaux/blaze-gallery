/**
 * S3 Audit Integration Examples
 * 
 * This file shows how to integrate S3 audit logging into existing S3 operations.
 * Add these logging calls to your existing S3 service methods.
 */

import { createS3AuditMiddleware } from './s3Audit';
import { S3Operation } from '@/types/audit';

const auditMiddleware = createS3AuditMiddleware();

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
  cacheHit?: boolean
) {
  await auditMiddleware.log({
    operation: 'GetObject',
    method: 'GET',
    endpoint: `/api/photos/${photoId}/thumbnail`,
    bucket: process.env.B2_BUCKET_NAME || 'unknown',
    key: `thumbnails/${photoId}`, // or actual S3 key
    startTime,
    statusCode,
    bytesTransferred,
    error,
    cacheHit,
    request
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
  responseData?: any, // Pass the actual response data instead of just item count
  error?: string
) {
  // Calculate actual response size if response data is provided
  let bytesTransferred: number | undefined;
  if (responseData) {
    bytesTransferred = JSON.stringify(responseData).length;
  }

  await auditMiddleware.log({
    operation: 'ListObjects',
    method: 'GET',
    endpoint: `/api/folders${folderPath ? `/${folderPath}` : ''}`,
    bucket: process.env.B2_BUCKET_NAME || 'unknown',
    key: folderPath || undefined,
    startTime,
    statusCode,
    bytesTransferred,
    error,
    request
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
  error?: string
) {
  await auditMiddleware.log({
    operation: 'GetObject',
    method: 'GET',
    endpoint: `/api/photos/download`,
    bucket: process.env.B2_BUCKET_NAME || 'unknown',
    key: photoKey,
    startTime,
    statusCode,
    bytesTransferred,
    error,
    request
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
  error?: string
) {
  await auditMiddleware.log({
    operation,
    method: 'GET',
    endpoint: `/api/bucket`,
    bucket: process.env.B2_BUCKET_NAME || 'unknown',
    startTime,
    statusCode,
    error,
    request
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
  s3Operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  let statusCode = 200;
  let error: string | undefined;
  let bytesTransferred: number | undefined;
  
  try {
    const result = await s3Operation();
    
    // Extract bytes transferred if available
    if (typeof result === 'object' && result !== null) {
      if ('ContentLength' in result) {
        bytesTransferred = (result as any).ContentLength;
      }
      if ('Body' in result && 'byteLength' in (result as any).Body) {
        bytesTransferred = (result as any).Body.byteLength;
      }
    }
    
    return result;
    
  } catch (err) {
    statusCode = 500;
    error = err instanceof Error ? err.message : 'Unknown error';
    
    // Extract status code from AWS error if available
    if (typeof err === 'object' && err !== null) {
      if ('$metadata' in err && typeof (err as any).$metadata === 'object') {
        const httpStatusCode = (err as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
      if ('statusCode' in err) {
        statusCode = (err as any).statusCode;
      }
    }
    
    throw err;
    
  } finally {
    if (request) {
      await auditMiddleware.log({
        operation,
        method: request.method as any,
        endpoint: new URL(request.url).pathname,
        bucket,
        key,
        startTime,
        statusCode,
        bytesTransferred,
        error,
        request
      });
    }
  }
}

/**
 * Cost estimation helpers
 * Add these to calculate estimated costs for S3 operations
 */
export function estimateS3Cost(operation: S3Operation, bytesTransferred?: number): number {
  // Basic cost estimation (adjust based on your AWS region and pricing)
  const costs: Record<S3Operation, number> = {
    GetObject: 0.0004 / 1000, // $0.0004 per 1,000 requests
    ListObjects: 0.005 / 1000,  // $0.005 per 1,000 requests
    ListBuckets: 0.0004 / 1000,
    PutObject: 0.005 / 1000,    // $0.005 per 1,000 requests
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
  
  let requestCost = costs[operation] || 0;
  
  // Add data transfer costs if applicable
  let transferCost = 0;
  if (bytesTransferred && operation === 'GetObject') {
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