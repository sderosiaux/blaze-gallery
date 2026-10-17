import type { Photo } from "@/types";

/** A share as listed by GET /api/shares (password hash stripped). */
export interface ShareLink {
  id: number | string;
  folder_path: string;
  folder_name?: string | null;
  share_token: string;
  expires_at: string | null;
  description: string | null;
  view_count: number;
  last_accessed: string | null;
  allow_download: boolean;
  is_active: boolean;
  created_at: string;
  has_password: boolean;
  /** Present when the listing joins the album's cover and EXIF date span. */
  cover_photo_id?: number | string | null;
  date_from?: string | null;
  date_to?: string | null;
}

/** What a guest receives once the link (and its password, if any) checks out. */
export interface SharedAlbum {
  share: Omit<ShareLink, "folder_name">;
  folder: { name: string; path: string; photo_count: number };
  photos: Photo[];
}

export type ShareState = "active" | "expired" | "revoked";

export function shareState(
  share: Pick<ShareLink, "is_active" | "expires_at">,
  now = Date.now(),
): ShareState {
  if (!share.is_active) return "revoked";
  if (share.expires_at && new Date(share.expires_at).getTime() <= now)
    return "expired";
  return "active";
}

/** Same base as the `share_url` the API returns, so copied links always match. */
export function shareUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  return `${base.replace(/\/$/, "")}/share/${token}`;
}

export function folderNameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function listShares(): Promise<ShareLink[]> {
  const response = await fetch("/api/shares", { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return (data.shares ?? []).map((s: ShareLink) => ({
    ...s,
    view_count: Number(s.view_count) || 0,
  }));
}

export interface CreateShareInput {
  folder_path: string;
  password?: string;
  expires_at?: string;
  description?: string;
  allow_download: boolean;
}

export async function createShare(
  input: CreateShareInput,
): Promise<{ share: ShareLink; share_url: string }> {
  const response = await fetch("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return {
    share: { ...data.share, has_password: Boolean(input.password) },
    share_url: data.share_url,
  };
}

export async function revokeShare(token: string): Promise<void> {
  const response = await fetch(`/api/shares/${token}`, { method: "DELETE" });
  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(data.error || `HTTP ${response.status}`);
  }
}

/** Guest side: the reasons a link can fail to open, each with its own page. */
export type GuestResult =
  | { kind: "album"; album: SharedAlbum; sessionToken?: string }
  | { kind: "password"; albumName?: string }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

const SESSION_KEY = (token: string) => `share_session_${token}`;
const SESSION_TTL = 24 * 60 * 60 * 1000;

export function storedSession(token: string): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(token));
    if (!raw) return null;
    const { token: session, expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) {
      localStorage.removeItem(SESSION_KEY(token));
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function storeSession(token: string, session: string | null) {
  try {
    if (session)
      localStorage.setItem(
        SESSION_KEY(token),
        JSON.stringify({ token: session, expiresAt: Date.now() + SESSION_TTL }),
      );
    else localStorage.removeItem(SESSION_KEY(token));
  } catch {
    // Private mode: the guest just types the password again next time.
  }
}

export async function openShare(token: string): Promise<GuestResult> {
  try {
    const response = await fetch(`/api/shares/${token}`, { cache: "no-store" });
    const data = await readJson(response);
    if (response.ok) return { kind: "album", album: data };
    if (response.status === 404) return { kind: "unavailable" };
    if (response.status === 401 && data.requires_password) {
      const session = storedSession(token);
      if (session) {
        const resumed = await fetch(`/api/shares/${token}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-share-session": session,
          },
          body: JSON.stringify({ action: "validate_session" }),
        });
        const body = await readJson(resumed);
        if (resumed.ok && body.success)
          return { kind: "album", album: body.data, sessionToken: session };
        storeSession(token, null);
      }
      return { kind: "password", albumName: data.folder?.name };
    }
    return { kind: "error", message: data.error || `HTTP ${response.status}` };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

export type UnlockResult = GuestResult | { kind: "wrong-password" };

export async function unlockShare(
  token: string,
  password: string,
): Promise<UnlockResult> {
  try {
    const response = await fetch(`/api/shares/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate_password", password }),
    });
    const data = await readJson(response);
    if (response.ok && data.success) {
      const { session_token, ...album } = data.data;
      storeSession(token, session_token);
      return { kind: "album", album, sessionToken: session_token };
    }
    if (response.status === 401) return { kind: "wrong-password" };
    if (response.status === 404) return { kind: "unavailable" };
    return { kind: "error", message: data.error || `HTTP ${response.status}` };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}

// Utility for making authenticated requests to share endpoints
export async function fetchWithSession(
  url: string,
  sessionToken?: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (sessionToken) {
    headers["x-share-session"] = sessionToken;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// Load image with session authentication and return blob URL
export async function loadImageWithSession(
  url: string,
  sessionToken?: string,
): Promise<string> {
  const response = await fetchWithSession(url, sessionToken);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// Clean up blob URLs
export function revokeBlobUrl(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
