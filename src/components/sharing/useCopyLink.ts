"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui";
import { copyText } from "./copyText";

export function useCopyLink() {
  const toast = useToast();
  return useCallback(
    async (url: string) => {
      if (await copyText(url)) toast.show("Link copied", "success");
      else toast.show("Couldn't copy the link. Select it and copy it by hand.", "error");
    },
    [toast],
  );
}
