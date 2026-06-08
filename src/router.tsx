import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Treat fetched data as fresh for 60s so navigating between pages
        // (and tab refocus) doesn't trigger a refetch + spinner every time.
        // Realtime subscriptions still push live updates within this window.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Reuse cached data on route preload instead of always refetching.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
