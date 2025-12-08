import { NextRequest, NextResponse } from "next/server";
import {
  createFolderShare,
  getAllSharedFolders,
  getFolderByPath,
} from "@/lib/database";
import { CreateShareData } from "@/lib/database";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      folder_path,
      password,
      expires_at,
      description,
      allow_download = true,
    }: {
      folder_path: string;
      password?: string;
      expires_at?: string;
      description?: string;
      allow_download?: boolean;
    } = body;

    // Validate required fields
    if (!folder_path) {
      return NextResponse.json(
        { error: "Folder path is required" },
        { status: 400 },
      );
    }

    // Decode URL-encoded path (e.g., %20 -> space)
    const decodedPath = decodeURIComponent(folder_path);

    console.log("[API] Share request - raw path:", folder_path);
    console.log("[API] Share request - decoded path:", decodedPath);

    // Validate that the folder exists
    const folder = await getFolderByPath(decodedPath);
    if (!folder) {
      console.log("[API] Folder not found for path:", decodedPath);
      return NextResponse.json({ error: "Folder not found", path: decodedPath }, { status: 404 });
    }

    console.log("[API] Found folder:", folder.id, folder.name);

    // Validate expiration date if provided
    if (expires_at) {
      const expirationDate = new Date(expires_at);
      if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
        return NextResponse.json(
          { error: "Invalid expiration date. Must be a future date." },
          { status: 400 },
        );
      }
    }

    // Create the share with decoded path
    const shareData: CreateShareData = {
      folder_path: decodedPath,
      folder_id: folder.id,
      password,
      expires_at,
      description,
      allow_download,
    };

    const share = await createFolderShare(shareData);

    // Return share details without password hash
    const { password_hash, ...shareResponse } = share;

    return NextResponse.json({
      success: true,
      share: shareResponse,
      share_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/share/${share.share_token}`,
    });
  } catch (error) {
    console.error("[API] Error creating folder share:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create folder share", details: errorMessage },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get all shared folders for management interface
    const shares = await getAllSharedFolders();

    // Remove password hashes from response
    const sharesResponse = shares.map(({ password_hash, ...share }) => ({
      ...share,
      has_password: !!password_hash,
    }));

    return NextResponse.json({
      success: true,
      shares: sharesResponse,
    });
  } catch (error) {
    console.error("[API] Error fetching shares:", error);
    return NextResponse.json(
      { error: "Failed to fetch shares" },
      { status: 500 },
    );
  }
}
