import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../context/theme";

export default function Index() {
  const { colors: c } = useAppTheme();
  const [target, setTarget] = useState<"/(auth)" | "/(tabs)" | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;
      setTarget(session ? "/(tabs)" : "/(auth)");
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setTarget(session ? "/(tabs)" : "/(auth)");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!target) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.background,
        }}
      >
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  return <Redirect href={target} />;
}
