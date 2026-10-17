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

export default function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { isAuthenticated, loading, error } = useAuth();

  if (loading) {
    return <PageSkeleton />;
  }

  if (error) {
    const notAllowed = error.includes("not authorized") || error.includes("not whitelisted");
    return (
      <EmptyState
        icon={ShieldAlert}
        title={notAllowed ? "This account isn't on the guest list" : "Sign-in didn't go through"}
        body={
          notAllowed
            ? "Only a few email addresses can open this gallery. Ask the owner to add yours, or sign in with another Google account."
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
        title="A private gallery"
        body="These photos are kept for the people they belong to. Sign in with an allowed Google account to open the library."
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
