import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { Colors } from "../constants/colors";

type ThemePref = "system" | "light" | "dark";
type ThemeColors = (typeof Colors)[keyof typeof Colors]; 

type ThemeCtx = {
  theme: ThemePref;
  setTheme: (t: ThemePref) => Promise<void>; 
  scheme: "light" | "dark";
  colors: ThemeColors; 
  ready: boolean;
};

const THEME_KEY = "theme-preference";
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = (useColorScheme() ?? "light") as "light" | "dark";
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(THEME_KEY);
      if (stored === "system" || stored === "light" || stored === "dark") {
        setThemeState(stored);
      }
      setReady(true);
    })();
  }, []);

  const setTheme = async (t: ThemePref) => {
    setThemeState(t);
    await AsyncStorage.setItem(THEME_KEY, t);
  };

  const scheme: "light" | "dark" = theme === "system" ? system : theme;
  const colors: ThemeColors = Colors[scheme];

  const value = useMemo(
    () => ({ theme, setTheme, scheme, colors, ready }),
    [theme, scheme, colors, ready]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppTheme must be used inside ThemeProvider");
  return v;
}
