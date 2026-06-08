import * as React from "react";
import { isRedirect, useRouter } from "@tanstack/react-router";

export function useServerFn<T extends (...args: any[]) => any>(serverFn: T) {
  const router = useRouter();

  return React.useCallback(
    async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      try {
        const res = await serverFn(...args);
        if (isRedirect(res)) throw res;
        return res as Awaited<ReturnType<T>>;
      } catch (err: any) {
        if (isRedirect(err)) {
          err.options._fromLocation = router.stores.location.get();
          return router.navigate(router.resolveRedirect(err).options) as Awaited<ReturnType<T>>;
        }
        throw err;
      }
    },
    [router, serverFn],
  );
}
