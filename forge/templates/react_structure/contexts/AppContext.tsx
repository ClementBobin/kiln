import { createContext, useContext, useState, type ReactNode } from "react";

interface AppContextValue {
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

/**
 * Example app-wide context — replace with your own. Demonstrates the
 * contexts/ convention: a Context + Provider + a matching useXxx() hook
 * for consuming it.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const toggleTheme = () =>
    setTheme((t) => (t === "light" ? "dark" : "light"));

  return (
    <AppContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);

  if (!ctx) {
    throw new Error("useAppContext must be used within an AppProvider");
  }

  return ctx;
}
