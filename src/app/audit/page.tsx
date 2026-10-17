"use client";

import AppLayout from "@/components/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { StorageAudit } from "@/components/audit/StorageAudit";

export default function AuditPage() {
  return (
    <AppLayout>
      <ProtectedRoute>
        <StorageAudit />
      </ProtectedRoute>
    </AppLayout>
  );
}
