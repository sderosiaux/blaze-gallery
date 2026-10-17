import { Suspense } from "react";
import type { Metadata } from "next";
import GuestAlbum, { GuestAlbumSkeleton } from "@/components/sharing/GuestAlbum";

// A share link is private by intent: keep it out of search engines even if it leaks.
export const metadata: Metadata = {
  title: "A shared album",
  robots: { index: false, follow: false },
};

export default function SharePage({ params }: { params: { token: string } }) {
  return (
    <Suspense fallback={<GuestAlbumSkeleton />}>
      <GuestAlbum token={params.token} />
    </Suspense>
  );
}
