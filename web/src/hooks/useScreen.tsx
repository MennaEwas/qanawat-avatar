import { createContext, ReactNode, useContext } from "react";

import { ScreenConfig, defaultScreen } from "@/lib/screen";

// The current screen's admin config (loaded server-side by the page), for
// any component that needs layout/theme/font settings.
const ScreenContext = createContext<ScreenConfig>(defaultScreen());

export function ScreenProvider({ screen, children }: { screen: ScreenConfig; children: ReactNode }) {
  return <ScreenContext.Provider value={screen}>{children}</ScreenContext.Provider>;
}

export function useScreen(): ScreenConfig {
  return useContext(ScreenContext);
}
