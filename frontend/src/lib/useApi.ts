import { useCallback, useEffect, useRef, useState } from "react";

/** Loads `fn()` on mount (and when `deps` change). `reload()` fetches again without clearing the old data. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(() => {
    const call = ++latest.current;
    setLoading(true);
    return fn()
      .then((d) => {
        if (call !== latest.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (call === latest.current) setError(e);
      })
      .finally(() => {
        if (call === latest.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
