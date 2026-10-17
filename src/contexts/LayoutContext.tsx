"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface LayoutContextType {
  sidebarCollapsed: boolean;
  /** False until the user toggles, so the first paint never animates the layout. */
  sidebarAnimated: boolean;
  toggleSidebar: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);
const STORAGE_KEY = "blaze:sidebar-collapsed";

export function useLayout() {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarAnimated, setSidebarAnimated] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarAnimated(true);
    setSidebarCollapsed((collapsed) => {
      localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1");
      return !collapsed;
    });
  }, []);

  return (
    <LayoutContext.Provider value={{ sidebarCollapsed, sidebarAnimated, toggleSidebar, mobileNavOpen, setMobileNavOpen }}>
      {children}
    </LayoutContext.Provider>
  );
}
