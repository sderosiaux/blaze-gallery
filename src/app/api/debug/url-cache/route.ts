import { NextResponse } from 'next/server';
import { getUrlCacheStats } from '@/lib/s3';

export async function GET() {
  try {
    const stats = getUrlCacheStats();
    
    return NextResponse.json({
      success: true,
      data: stats
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}