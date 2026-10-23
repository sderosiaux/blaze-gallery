import { requireAuth } from "@/lib/auth/middleware";
import { duplicateReport } from "../_duplicates";

export const dynamic = "force-dynamic";

export const GET = requireAuth((request) => duplicateReport(request, "files"));
