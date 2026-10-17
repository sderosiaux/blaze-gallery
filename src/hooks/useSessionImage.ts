import { useEffect, useState } from "react";

interface State {
  status: "loading" | "ready" | "error";
  src?: string;
}

/**
 * A password-protected share only serves originals with the `x-share-session`
 * header, which an <img> or <video> can't send: fetch the bytes and hand the
 * element a blob URL. Without a session token the URL is used as is.
 */
export function useSessionImage(
  url: string | null,
  sessionToken?: string,
): State {
  const [state, setState] = useState<State>(() =>
    url && !sessionToken
      ? { status: "ready", src: url }
      : { status: "loading" },
  );

  useEffect(() => {
    if (!url) {
      setState({ status: "error" });
      return;
    }
    if (!sessionToken) {
      setState({ status: "ready", src: url });
      return;
    }

    setState({ status: "loading" });
    const abort = new AbortController();
    let objectUrl: string | undefined;

    fetch(url, {
      headers: { "x-share-session": sessionToken },
      signal: abort.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", src: objectUrl });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({ status: "error" });
      });

    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, sessionToken]);

  return state;
}
