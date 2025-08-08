"use client";

import { useEffect, useRef } from "react";

export default function StartupManager() {
  const hasStarted = useRef(false);

  useEffect(() => {
    // Only run startup once per browser session
    if (hasStarted.current) {
      return;
    }

    hasStarted.current = true;

    // Check if startup was completed recently (within last 5 minutes)
    const lastStartup = localStorage.getItem("blazeGalleryLastStartup");
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    if (lastStartup && parseInt(lastStartup) > fiveMinutesAgo) {
      console.debug("Startup completed recently, skipping...");
      return;
    }

    const initializeApp = async () => {
      try {
        const response = await fetch("/api/startup", {
          method: "GET",
          cache: "no-cache",
        });

        if (!response.ok) {
          console.warn("Startup API request failed:", response.statusText);
          return;
        }

        const result = await response.json();
        if (result.success) {
          // Store successful startup timestamp
          localStorage.setItem(
            "blazeGalleryLastStartup",
            Date.now().toString(),
          );
        }
      } catch (error) {
        // Startup failure shouldn't break the UI
        console.warn("Failed to initialize application:", error);
      }
    };

    // Run startup asynchronously without blocking the UI
    initializeApp();
  }, []);

  // This component renders nothing
  return null;
}
