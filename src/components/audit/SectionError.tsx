import { CloudOff, RotateCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** One section's failure: what broke, the raw server message, a retry. The rest of the page stays. */
export function SectionError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      icon={CloudOff}
      title={title}
      body={
        <span className="block font-mono text-xs text-ink-faint">{error}</span>
      }
      action={
        <Button icon={RotateCw} onClick={onRetry}>
          Réessayer
        </Button>
      }
      className="py-10"
    />
  );
}
