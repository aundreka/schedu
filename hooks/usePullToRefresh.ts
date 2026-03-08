import { useCallback, useState } from "react";

export function usePullToRefresh(onRefreshAction: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshAction();
    } finally {
      setRefreshing(false);
    }
  }, [onRefreshAction, refreshing]);

  return { refreshing, onRefresh };
}
