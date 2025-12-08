"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

interface LayoutContextType {
  isFullWidth: boolean;
  setIsFullWidth: (value: boolean) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function useLayout() {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }
  return context;
}

interface LayoutProviderProps {
  children: ReactNode;
}

export function LayoutProvider({ children }: LayoutProviderProps) {
  const [isFullWidth, setIsFullWidth] = useState(false);

  return (
    <LayoutContext.Provider value={{ isFullWidth, setIsFullWidth }}>
      {children}
    </LayoutContext.Provider>
  );
}
