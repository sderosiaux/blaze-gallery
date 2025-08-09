// Utility for making authenticated requests to share endpoints
export async function fetchWithSession(url: string, sessionToken?: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {})
  };

  if (sessionToken) {
    headers['x-share-session'] = sessionToken;
  }

  return fetch(url, {
    ...options,
    headers
  });
}

// Load image with session authentication and return blob URL
export async function loadImageWithSession(url: string, sessionToken?: string): Promise<string> {
  const response = await fetchWithSession(url, sessionToken);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// Clean up blob URLs
export function revokeBlobUrl(url: string) {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}