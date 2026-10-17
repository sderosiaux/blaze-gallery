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
      body="The library didn't answer this time. Your photos are safe; check the connection and try again."
      action={
        <Button variant="secondary" icon={RotateCw} onClick={onRetry}>
          Try again
        </Button>
      }
      className={className}
    />
  );
}
