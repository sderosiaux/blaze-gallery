/** All the stacks in « Copies identiques », independently of pagination. */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inGallery, runTransaction } from "./database";
import { GROUPS_LOCK } from "./groupsLock";
import { carryNames } from "./people";
import { STACKS } from "./stacks";
import { markTrashed, newLot } from "./trash";

export interface CopiesSelection {
  /** Photos already chosen on screen; unseen stacks use their first rank. */
  keep: number[];
  /** Stacks the owner unchecked on screen. */
  skip: number[];
}

export interface CopiesPreview {
  count: number;
  stacks: number;
  signature: string;
}

export class CopiesRefused extends Error {
  constructor(readonly code: "STACKS_CHANGED" | "PASS_RUNNING") {
    super(
      code === "PASS_RUNNING"
        ? "Une passe est en cours, réessayez dans un moment."
        : "Les piles ont changé : rien n’a été mis à la corbeille. Rechargez les piles pour réessayer.",
    );
  }
}

async function plan(client: PoolClient, selection: CopiesSelection) {
  // The same strict MD5/copy-group test as the tab, with no LIMIT. An
  // embedding is unnecessary here: these are copies of the same file.
  const result = await client.query<{
    id: number;
    group_id: number;
    keep: number;
    choices: number;
    etag: string;
    s3_key: string;
    size: string;
  }>(
    `WITH ${STACKS}
     SELECT p.id::int AS id, g.group_id::int AS group_id, p.etag, p.s3_key, p.size,
       first_value(p.id) OVER (
         PARTITION BY g.group_id
         ORDER BY (p.id = ANY($1::bigint[])) DESC, g.rank, p.id
       )::int AS keep,
       count(*) FILTER (WHERE p.id = ANY($1::bigint[]))
         OVER (PARTITION BY g.group_id)::int AS choices
     FROM stacks s
     JOIN photo_groups g ON g.group_id = s.group_id
     JOIN photos p ON p.id = g.photo_id
     WHERE s.copies AND NOT (s.group_id = ANY($2::bigint[])) AND ${inGallery()}
     ORDER BY p.id`,
    [selection.keep, selection.skip],
  );
  const rows = result.rows;
  const ids = new Set(rows.map((row) => row.id));
  if (
    selection.keep.some((id) => !ids.has(id)) ||
    rows.some((row) => row.choices > 1)
  )
    throw new CopiesRefused("STACKS_CHANGED");
  const going = rows
    .filter((row) => row.id !== row.keep)
    .map(({ id, keep }) => ({ id, keep }));
  const preview: CopiesPreview = {
    count: going.length,
    stacks: new Set(rows.map((row) => row.group_id)).size,
    // Confirm the exact photos AND keepers, not just a count that could
    // remain the same while the contents of the stacks changed.
    signature: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
  return { preview, going, ids: [...ids] };
}

export function previewAllCopies(selection: CopiesSelection) {
  return runTransaction(
    async (client) => (await plan(client, selection)).preview,
  );
}

/** One atomic, restorable lot, however many pages or photos it contains. */
export async function trashAllCopies(
  selection: CopiesSelection,
  signature: string,
): Promise<{ count: number; lot: string }> {
  try {
    return await runTransaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const locked = await client.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1) AS ok",
        [GROUPS_LOCK],
      );
      const leased = await client.query(
        "SELECT 1 FROM task_leases WHERE task = 'groups' AND expires_at > now()",
      );
      if (!locked.rows[0]?.ok || leased.rows.length > 0)
        throw new CopiesRefused("PASS_RUNNING");
      const current = await plan(client, selection);
      if (current.preview.signature !== signature || current.going.length === 0)
        throw new CopiesRefused("STACKS_CHANGED");
      // Also lock the keepers. A concurrent trash/restore since the
      // snapshot then fails the whole transaction, before any photo moves.
      await client.query(
        "SELECT id FROM photos WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
        [current.ids],
      );
      await carryNames(client, current.going);
      const lot = newLot("owner", "copies");
      const trashed = await markTrashed(client, current.going, lot);
      if (trashed.length !== current.preview.count)
        throw new CopiesRefused("STACKS_CHANGED");
      return { count: trashed.length, lot: lot.batch };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "40001"
    )
      throw new CopiesRefused("STACKS_CHANGED");
    throw error;
  }
}
