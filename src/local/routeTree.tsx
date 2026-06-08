import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Outlet, createRootRouteWithContext, createRoute } from "@tanstack/react-router";

import { Toaster } from "../components/ui/sonner";
import { AuthProvider } from "../lib/auth";
import { Route as LoginRouteImport } from "../routes/login";
import { Route as AuthenticatedRouteImport } from "../routes/_authenticated";
import { Route as ProductsRouteImport } from "../routes/_authenticated/products";
import { Route as StockOutRouteImport } from "../routes/_authenticated/stock-out";

const rootRouteImport = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: function LocalRoot() {
    const { queryClient } = rootRouteImport.useRouteContext();
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </QueryClientProvider>
    );
  },
});

const IndexRoute = createRoute({
  getParentRoute: () => rootRouteImport,
  path: "/",
  component: () => <Navigate to="/products" replace />,
});

const LoginRoute = LoginRouteImport.update({
  id: "/login",
  path: "/login",
  getParentRoute: () => rootRouteImport,
} as any);

const AuthenticatedRoute = AuthenticatedRouteImport.update({
  id: "/_authenticated",
  getParentRoute: () => rootRouteImport,
} as any);

const ProductsRoute = ProductsRouteImport.update({
  id: "/products",
  path: "/products",
  getParentRoute: () => AuthenticatedRoute,
} as any);

const StockOutRoute = StockOutRouteImport.update({
  id: "/stock-out",
  path: "/stock-out",
  getParentRoute: () => AuthenticatedRoute,
} as any);

const AuthenticatedRouteWithChildren = AuthenticatedRoute._addFileChildren({
  ProductsRoute,
  StockOutRoute,
});

export const routeTree = rootRouteImport._addFileChildren({
  IndexRoute,
  LoginRoute,
  AuthenticatedRoute: AuthenticatedRouteWithChildren,
});
