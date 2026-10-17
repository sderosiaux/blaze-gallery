import { Badge, Section, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AuditOperation } from "./types";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatShare,
  operationLabel,
  successLook,
} from "./format";
import { SectionError } from "./SectionError";

interface OperationsTableProps {
  operations: AuditOperation[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const th =
  "pb-3 text-xs font-medium uppercase tracking-[0.08em] text-ink-muted";

function SuccessBadge({ op }: { op: AuditOperation }) {
  const look = successLook(op.success_rate);
  return (
    <Badge tone={look.tone} icon={look.icon}>
      {look.label}
    </Badge>
  );
}

function OperationName({ op }: { op: AuditOperation }) {
  const label = operationLabel(op.operation);
  return (
    <span className="min-w-0">
      <span className="block truncate font-medium text-ink">{label}</span>
      {label !== op.operation && (
        <span className="block truncate text-xs text-ink-muted">
          {op.operation}
        </span>
      )}
    </span>
  );
}

export function OperationsTable({
  operations,
  loading,
  error,
  onRetry,
}: OperationsTableProps) {
  let body: React.ReactNode;

  if (error) {
    body = (
      <SectionError
        title="Le détail des opérations n’a pas chargé"
        error={error}
        onRetry={onRetry}
      />
    );
  } else if (!operations) {
    body = (
      <div
        role="status"
        aria-label="Chargement des opérations"
        className="space-y-3"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (operations.length === 0) {
    body = (
      <p className="py-6 text-sm text-ink-muted">
        Aucune opération sur cette période.
      </p>
    );
  } else {
    const total = operations.reduce((acc, op) => acc + op.count, 0);
    body = (
      <div
        aria-busy={loading || undefined}
        className={cn(
          "transition-opacity duration-200",
          loading && "opacity-60",
        )}
      >
        {/* Table from md up; below, each operation becomes a short card-less block. */}
        <table className="hidden w-full table-fixed text-sm md:table">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className={cn(th, "w-[30%]")}>
                Opération
              </th>
              <th scope="col" className={cn(th, "text-right")}>
                Requêtes
              </th>
              <th scope="col" className={cn(th, "text-right")}>
                Moyenne
              </th>
              <th scope="col" className={cn(th, "text-right")}>
                p95
              </th>
              <th scope="col" className={cn(th, "w-[18%] pl-6")}>
                Succès
              </th>
              <th scope="col" className={cn(th, "text-right")}>
                Données
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {operations.map((op) => (
              <tr
                key={op.operation}
                className="border-b border-line last:border-b-0"
              >
                <td className="py-3 pr-4">
                  <OperationName op={op} />
                </td>
                <td className="py-3 text-right text-ink">
                  {formatCount(op.count)}
                  <span className="block text-xs text-ink-muted">
                    {formatShare(op.count / total)}
                  </span>
                </td>
                <td className="py-3 text-right text-ink">
                  {formatDuration(op.avg_duration_ms)}
                </td>
                <td className="py-3 text-right text-ink">
                  {formatDuration(op.p95_duration_ms)}
                </td>
                <td className="py-3 pl-6">
                  <SuccessBadge op={op} />
                  {op.error_count > 0 && (
                    <span className="mt-1 block text-xs text-ink-muted">
                      {formatCount(op.error_count)} en échec
                    </span>
                  )}
                </td>
                <td className="py-3 text-right text-ink">
                  {formatBytes(op.total_bytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-line md:hidden">
          {operations.map((op) => (
            <li key={op.operation} className="py-4 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <OperationName op={op} />
                <SuccessBadge op={op} />
              </div>
              <dl className="tabular mt-3 grid grid-cols-4 gap-2 text-sm">
                {[
                  ["Requêtes", formatCount(op.count)],
                  ["Moyenne", formatDuration(op.avg_duration_ms)],
                  ["p95", formatDuration(op.p95_duration_ms)],
                  ["Données", formatBytes(op.total_bytes)],
                ].map(([term, value]) => (
                  <div key={term} className="min-w-0">
                    <dt className="text-xs text-ink-muted">{term}</dt>
                    <dd className="truncate text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <Section
      id="operations"
      title="Opérations"
      description="Échec : réponse 400 ou plus du stockage"
    >
      {body}
    </Section>
  );
}
