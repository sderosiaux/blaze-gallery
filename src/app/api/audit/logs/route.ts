import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from "@/lib/auth/middleware";
import { s3AuditLogger } from '@/lib/s3Audit';
import { S3AuditQuery } from '@/types/audit';

export const dynamic = 'force-dynamic';

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const query: S3AuditQuery = {
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      operation: searchParams.get('operation') as any || undefined,
      status_code: searchParams.get('status_code') ? parseInt(searchParams.get('status_code')!) : undefined,
      bucket: searchParams.get('bucket') || undefined,
      min_duration_ms: searchParams.get('min_duration_ms') ? parseInt(searchParams.get('min_duration_ms')!) : undefined,
      max_duration_ms: searchParams.get('max_duration_ms') ? parseInt(searchParams.get('max_duration_ms')!) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
      sort_by: searchParams.get('sort_by') as any || 'timestamp',
      sort_order: searchParams.get('sort_order') as any || 'desc'
    };
    
    // Validate limits
    if (query.limit && query.limit > 1000) {
      query.limit = 1000; // Prevent excessive data requests
    }
    
    const result = await s3AuditLogger.queryLogs(query);
    
    return NextResponse.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('[AUDIT API] Error querying logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to query audit logs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});

export const DELETE = requireAuth(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const retentionDays = searchParams.get('retention_days');
    
    if (!retentionDays || isNaN(parseInt(retentionDays))) {
      return NextResponse.json(
        {
          success: false,
          error: 'retention_days parameter is required and must be a number'
        },
        { status: 400 }
      );
    }
    
    const deletedCount = await s3AuditLogger.cleanupOldLogs(parseInt(retentionDays));
    
    return NextResponse.json({
      success: true,
      data: {
        deleted_records: deletedCount,
        retention_days: parseInt(retentionDays)
      }
    });
    
  } catch (error) {
    console.error('[AUDIT API] Error cleaning up logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to cleanup audit logs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
});