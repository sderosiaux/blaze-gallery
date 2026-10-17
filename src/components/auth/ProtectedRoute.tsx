"use client";

import { ReactNode } from "react";
import { Lock, ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import AuthButton from "./AuthButton";
import { EmptyState, PageSkeleton } from "@/components/ui";

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export default function ProtectedRoute({
  children,
  fallback,
}: ProtectedRouteProps) {
  const { isAuthenticated, loading, error } = useAuth();

  if (loading) {
    return <PageSkeleton />;
  }

  if (error) {
    const notAllowed =
      error === "not_authorized" ||
      error.includes("not authorized") ||
      error.includes("not whitelisted");
    return (
      <EmptyState
        icon={ShieldAlert}
        title={
          notAllowed
            ? "Ce compte n'a pas accès"
            : "La connexion n'a pas abouti"
        }
        body={
          notAllowed
            ? "Connectez-vous avec un autre compte Google, ou demandez l'accès."
            : error
        }
        action={
          <div className="w-64">
            <AuthButton />
          </div>
        }
        className="py-24"
      />
    );
  }

  if (!isAuthenticated) {
    if (fallback) return <>{fallback}</>;
    return (
      <EmptyState
        icon={Lock}
        title="Galerie privée"
        body="Connectez-vous avec un compte Google autorisé."
        action={
          <div className="w-64">
            <AuthButton />
          </div>
        }
        className="py-24"
      />
    );
  }

  return <>{children}</>;
}
