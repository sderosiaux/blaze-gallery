import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getPhoto, query } from "@/lib/database";
import { photoFace, photoFaceRows } from "@/lib/people";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/**
 * GET /api/photos/:id/faces: the faces found on the photo, boxes on the photo
 * as shown (hand rotation applied), with the name of whoever each one is.
 */
export const GET = requireAuth(async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("invalid_photo_id");
  try {
    const photo = await getPhoto(id);
    if (!photo) {
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }
    const [rows, job] = await Promise.all([
      photoFaceRows([id]),
      query<{ status: string }>(
        "SELECT status FROM analysis_jobs WHERE photo_id = $1 AND task = 'faces'",
        [id],
      ),
    ]);
    return NextResponse.json({
      success: true,
      // No face can mean none on it, or not looked at yet
      analyzed: job.rows[0]?.status === "done",
      faces: rows.map((row) => photoFace(row, photo.metadata)),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/photos/[id]/faces" });
  }
});
