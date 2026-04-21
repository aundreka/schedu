import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { getLessonPlanRefreshVersion, subscribeToLessonPlanRefresh } from "../../lib/lesson-plan-refresh";

export default function Home() {
  const [refreshVersion, setRefreshVersion] = useState(getLessonPlanRefreshVersion());

  useEffect(() => {
    return subscribeToLessonPlanRefresh((version) => {
      setRefreshVersion(version);
    });
  }, []);

  return (
    <View
      key={refreshVersion}
      style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
    >
      <Text>Home</Text>
    </View>
  );
}
