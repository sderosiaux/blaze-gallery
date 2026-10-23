/** The stats report and its trash actions share these exact-content groups. */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inGallery, query, requireRow, runTransaction } from "./database";
import { GROUPS_LOCK } from "./groupsLock";
import { carryNames } from "./people";
import { markTrashed, newLot } from "./trash";
import type {
  DuplicateCursor,
  DuplicateKind,
  DuplicatePreview,
  DuplicateSelection,
  ExactDuplicateGroup,
  ExactDuplicatesPage,
} from "./exactDuplicateTypes";

const PAGE = 24;

// Same storage scope as the stats report: includes Hors galerie, but no
// trashed, system, NAS thumbnail or <= 10 KiB files. Never requires a stack,
// embedding, filename match (files), or a particular media type.
const CANDIDATES = `candidates AS MATERIALIZED (
  SELECT p.id, p.folder_id, p.filename, p.s3_key, p.etag, p.size,
    coalesce(p.is_favorite, false) AS favorite, f.path, f.name,
    (${inGallery()}) AS in_gallery
  FROM photos p JOIN folders f ON f.id = p.folder_id
  WHERE p.trashed_at IS NULL AND p.size > 10240
    AND f.path NOT LIKE '%@eaDir%'
    AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
    AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
)`;

const MEMBERS: Record<DuplicateKind, string> = {
  files: `SELECT id, md5(jsonb_build_array(etag, size)::text) AS key,
    filename AS name, path, in_gallery, favorite, 1::int AS file_count, size::float8 AS bytes
    FROM candidates WHERE etag ~ '^[0-9a-f]{32}$'`,
  // Structured tuples avoid delimiter collisions. All eligible files in
  // each folder must have a real MD5; unknown/multipart ETags prove nothing.
  folders: `SELECT folder_id AS id,
    md5(jsonb_agg(jsonb_build_array(filename, size, etag) ORDER BY filename, size, etag)::text) AS key,
    min(name) AS name, min(path) AS path, bool_and(in_gallery) AS in_gallery,
    bool_or(favorite) AS favorite, count(*)::int AS file_count, sum(size)::float8 AS bytes
    FROM candidates GROUP BY folder_id
    HAVING bool_and(coalesce(etag ~ '^[0-9a-f]{32}$', false))`,
};

const ctes = (kind: DuplicateKind) => `${CANDIDATES},
  members AS MATERIALIZED (${MEMBERS[kind]}),
  groups AS MATERIALIZED (
    SELECT key, count(*)::int AS count, min(file_count)::int AS files_per_member,
      min(bytes)::float8 AS bytes_per_member,
      (sum(file_count) - min(file_count))::int AS extra_files,
      (sum(bytes) - min(bytes))::float8 AS extra_bytes
    FROM members GROUP BY key HAVING count(*) > 1
  )`;

// Prefer a copy that remains visible, then a favourite; keep the order
// identical in the report and in the server's plan for unseen groups.
const MEMBER_ORDER = `m.in_gallery DESC, m.favorite DESC, m.path COLLATE "C", m.id`;

export async function listExactDuplicates(
  kind: DuplicateKind,
  after: DuplicateCursor | null,
): Promise<ExactDuplicatesPage> {
  const result = await query<{
    summary: ExactDuplicatesPage["summary"];
    groups: ExactDuplicateGroup[];
  }>(
    `WITH ${ctes(kind)},
     page AS MATERIALIZED (
       SELECT * FROM groups
       WHERE $1::float8 IS NULL OR extra_bytes < $1 OR (extra_bytes = $1 AND key > $2)
       ORDER BY extra_bytes DESC, key LIMIT $3
     ),
     locations AS (
       SELECT m.key, json_agg(json_build_object(
         'id', m.id::int, 'name', m.name, 'path', m.path, 'outside_gallery', NOT m.in_gallery
       ) ORDER BY ${MEMBER_ORDER}) AS members
       FROM members m JOIN page p ON p.key = m.key GROUP BY m.key
     )
     SELECT (SELECT json_build_object(
       'groups', count(*)::int, 'members', coalesce(sum(count), 0)::int,
       'extra_files', coalesce(sum(extra_files), 0)::int,
       'extra_bytes', coalesce(sum(extra_bytes), 0)::float8
     ) FROM groups) AS summary,
     coalesce((SELECT json_agg(json_build_object(
       'key', p.key, 'count', p.count, 'files_per_member', p.files_per_member,
       'bytes_per_member', p.bytes_per_member, 'extra_files', p.extra_files,
       'extra_bytes', p.extra_bytes, 'members', l.members
     ) ORDER BY p.extra_bytes DESC, p.key)
     FROM page p JOIN locations l ON l.key = p.key), '[]'::json) AS groups`,
    [after?.bytes ?? null, after?.key ?? "", PAGE + 1],
  );
  const row = requireRow(result);
  const groups = row.groups.slice(0, PAGE);
  const last = groups[groups.length - 1];
  return {
    summary: row.summary,
    groups,
    next:
      row.groups.length > PAGE && last
        ? { bytes: last.extra_bytes, key: last.key }
        : null,
  };
}

export class DuplicatesRefused extends Error {
  constructor(readonly code: "DUPLICATES_CHANGED" | "PASS_RUNNING") {
    super(
      code === "PASS_RUNNING"
        ? "Une passe est en cours, réessayez dans un moment."
        : "Les fichiers ont changé : rien n’a été mis à la corbeille. Actualisez l’analyse pour réessayer.",
    );
  }
}

async function plan(client: PoolClient, selection: DuplicateSelection) {
  const { rows } = await client.query<{
    id: number;
    key: string;
    name: string;
    path: string;
    bytes: number;
    file_count: number;
  }>(
    `WITH ${ctes(selection.kind)}
     SELECT m.id::int, m.key, m.name, m.path, m.bytes, m.file_count
     FROM members m JOIN groups g ON g.key = m.key
     WHERE ($1 = 'all' OR m.key = $1) AND NOT (m.key = ANY($2::text[]))
     ORDER BY m.key, ${MEMBER_ORDER}`,
    [selection.group, selection.skip],
  );
  const ids = new Set(rows.map((m) => m.id));
  const selected = new Set(selection.keep);
  if (
    selection.keep.some((id) => !ids.has(id)) ||
    (selection.group !== "all" && rows.length === 0)
  )
    throw new DuplicatesRefused("DUPLICATES_CHANGED");
  const groups = new Map<string, typeof rows>();
  for (const member of rows) {
    const group = groups.get(member.key) ?? [];
    group.push(member);
    groups.set(member.key, group);
  }
  const members: { id: number; keep: number; bytes: number; files: number }[] =
    [];
  for (const group of groups.values()) {
    const chosen = group.filter((m) => selected.has(m.id));
    if (chosen.length > 1) throw new DuplicatesRefused("DUPLICATES_CHANGED");
    const keeper = chosen[0] ?? group[0];
    if (!keeper) continue;
    for (const m of group)
      if (m.id !== keeper.id)
        members.push({
          id: m.id,
          keep: keeper.id,
          bytes: m.bytes,
          files: m.file_count,
        });
  }
  let pairs: { id: number; keep: number }[] = members.map(({ id, keep }) => ({
    id,
    keep,
  }));
  if (selection.kind === "folders" && members.length > 0) {
    // Only direct, eligible files with an exact counterpart in the kept
    // folder move. Subfolders, small/system files and folder rows stay.
    const matched = await client.query<{ id: number; keep: number }>(
      `WITH ${CANDIDATES}, chosen AS (
        SELECT * FROM unnest($1::bigint[], $2::bigint[]) AS t(id, keep)
      )
      SELECT DISTINCT ON (p.id) p.id::int AS id, k.id::int AS keep
      FROM chosen t JOIN candidates p ON p.folder_id = t.id
      JOIN candidates k ON k.folder_id = t.keep
        AND k.filename = p.filename AND k.size = p.size AND k.etag = p.etag
      ORDER BY p.id, k.id`,
      [members.map((m) => m.id), members.map((m) => m.keep)],
    );
    pairs = matched.rows;
    if (pairs.length !== members.reduce((sum, m) => sum + m.files, 0))
      throw new DuplicatesRefused("DUPLICATES_CHANGED");
  }
  pairs.sort((a, b) => a.id - b.id);
  const preview: DuplicatePreview = {
    count: pairs.length,
    bytes: members.reduce((sum, m) => sum + m.bytes, 0),
    groups: groups.size,
    signature: createHash("sha256")
      .update(JSON.stringify({ kind: selection.kind, rows, pairs }))
      .digest("hex"),
  };
  return { preview, pairs };
}

export function previewDuplicates(selection: DuplicateSelection) {
  return runTransaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    return (await plan(client, selection)).preview;
  });
}

export async function trashDuplicates(
  selection: DuplicateSelection,
  signature: string,
) {
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
        throw new DuplicatesRefused("PASS_RUNNING");
      const current = await plan(client, selection);
      if (current.preview.signature !== signature || current.pairs.length === 0)
        throw new DuplicatesRefused("DUPLICATES_CHANGED");
      const ids = [...new Set(current.pairs.flatMap((p) => [p.id, p.keep]))];
      await client.query(
        "SELECT id FROM photos WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      await carryNames(client, current.pairs);
      const lot = newLot("owner", `verified-${selection.kind}`);
      const moved = await markTrashed(client, current.pairs, lot);
      if (moved.length !== current.preview.count)
        throw new DuplicatesRefused("DUPLICATES_CHANGED");
      return { count: moved.length, lot: lot.batch };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "40001"
    )
      throw new DuplicatesRefused("DUPLICATES_CHANGED");
    throw error;
  }
}
