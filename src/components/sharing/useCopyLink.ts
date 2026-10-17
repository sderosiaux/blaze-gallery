"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui";
import { copyText } from "./copyText";

export function useCopyLink() {
  const toast = useToast();
  return useCallback(
    async (url: string) => {
      if (await copyText(url)) toast.show("Lien copié", "success");
      else toast.show("Le lien n'a pas pu être copié.", "error");
    },
    [toast],
  );
}
