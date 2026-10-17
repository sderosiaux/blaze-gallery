import { CloudOff, RotateCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

interface LoadErrorProps {
  title: React.ReactNode;
  onRetry: () => void;
  className?: string;
}

export function LoadError({ title, onRetry, className }: LoadErrorProps) {
  return (
    <EmptyState
      icon={CloudOff}
      title={title}
      action={
        <Button variant="secondary" icon={RotateCw} onClick={onRetry}>
          Réessayer
        </Button>
      }
      className={className}
    />
  );
}
