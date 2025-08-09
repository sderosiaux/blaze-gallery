import { NextRequest, NextResponse } from 'next/server';
import { s3AuditLogger } from '@/lib/s3Audit';
import { S3AuditQuery } from '@/types/audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters for filtering stats
    const query: S3AuditQuery = {
      start_date: searchParams.get('start_date') || undefined,
      end_date: searchParams.get('end_date') || undefined,
      operation: searchParams.get('operation') as any || undefined,
      bucket: searchParams.get('bucket') || undefined,
    };
    
    const stats = await s3AuditLogger.calculateStats(query);
    
    return NextResponse.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('[AUDIT API] Error calculating stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to calculate audit stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}