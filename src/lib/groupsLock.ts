/**
 * The worker's groups lock (worker groups.py LOCK), as a transaction lock:
 * every write of the stacks takes it (a rebuild, the Grouper, a pass of
 * npm run dedupe), and so does « Garder », so that no two of them throw
 * photos of one stack away at once.
 */
export const GROUPS_LOCK = 0x626c617a6567;
