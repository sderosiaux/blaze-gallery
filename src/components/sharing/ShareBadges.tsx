import { Ban, CheckCircle2, Clock, Lock } from "lucide-react";
import { Badge } from "@/components/ui";
import { shareState, type ShareLink, type ShareState } from "@/lib/shareClient";

const STATE: Record<
  ShareState,
  { label: string; tone: "success" | "warning" | "neutral"; icon: typeof Ban }
> = {
  active: { label: "Actif", tone: "success", icon: CheckCircle2 },
  expired: { label: "Expiré", tone: "warning", icon: Clock },
  revoked: { label: "Révoqué", tone: "neutral", icon: Ban },
};

export function ShareStateBadge({ state }: { state: ShareState }) {
  const s = STATE[state];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

/** The state, plus the password while the link still works: it decides whom the link can go to. */
export function ShareBadges({
  share,
}: {
  share: Pick<ShareLink, "is_active" | "expires_at" | "has_password">;
}) {
  const state = shareState(share);
  if (state !== "active" || !share.has_password)
    return <ShareStateBadge state={state} />;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ShareStateBadge state={state} />
      <Badge tone="neutral" icon={Lock}>
        Mot de passe
      </Badge>
    </span>
  );
}
