import { Ban, CheckCircle2, Clock, EyeOff, Lock } from "lucide-react";
import { Badge } from "@/components/ui";
import { shareState, type ShareLink, type ShareState } from "@/lib/shareClient";

const STATE: Record<ShareState, { label: string; tone: "success" | "warning" | "neutral"; icon: typeof Ban }> = {
  active: { label: "Active", tone: "success", icon: CheckCircle2 },
  expired: { label: "Expired", tone: "warning", icon: Clock },
  revoked: { label: "Revoked", tone: "neutral", icon: Ban },
};

export function ShareStateBadge({ state }: { state: ShareState }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** State first, then the two settings a guest feels: the password and the download button. */
export function ShareBadges({
  share,
  showViewOnly = true,
}: {
  share: Pick<ShareLink, "is_active" | "expires_at" | "has_password" | "allow_download">;
  showViewOnly?: boolean;
}) {
  const state = shareState(share);
  // Settings only matter while the link works; a dead link shows just why it is dead.
  if (state !== "active") return <ShareStateBadge state={state} />;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ShareStateBadge state={state} />
      {share.has_password && (
        <Badge tone="info" icon={Lock}>
          Protected
        </Badge>
      )}
      {showViewOnly && !share.allow_download && (
        <Badge tone="neutral" icon={EyeOff}>
          View only
        </Badge>
      )}
    </span>
  );
}
