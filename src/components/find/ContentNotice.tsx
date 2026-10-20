/** Says the filter's words could not be applied (no embedder answer): the photos are filtered without them. */
export function ContentNotice({
  status,
}: {
  status: "ok" | "unavailable" | null;
}) {
  if (status !== "unavailable") return null;
  return (
    <p role="status" className="-mt-3 mb-5 text-sm text-ink-muted">
      La recherche par le contenu ne répond pas : les mots ne sont pas
      appliqués.
    </p>
  );
}
