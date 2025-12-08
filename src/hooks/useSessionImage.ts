import { useState, useEffect } from "react";

export function useSessionImage(url: string, sessionToken?: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!url) return;

    // If no session token needed, use URL directly
    if (!sessionToken) {
      setBlobUrl(url);
      setLoading(false);
      return;
    }

    // Clean up previous blob URL
    return () => {
      if (blobUrl && blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [url, sessionToken]);

  // For now, just return the original URL - we'll implement session loading later if needed
  // The API endpoints will handle session validation
  return {
    imageUrl: url,
    loading: false,
    error: null,
  };
}
