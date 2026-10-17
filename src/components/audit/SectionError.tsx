import { CloudOff, RotateCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** One section's failure: says what broke and offers a retry, the rest of the page stays. */
export function SectionError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon={CloudOff}
      title={title}
      body={
        <>
          {error} Try again; if it keeps failing, the server log has the details.
        </>
      }
      action={
        <Button icon={RotateCw} onClick={onRetry}>
          Try again
        </Button>
      }
      className="py-10"
    />
  );
}
