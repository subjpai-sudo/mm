import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { Toaster } from "../components/ui/sonner";
import { AuthProvider } from "../lib/auth";
import { Route as LoginRouteImport } from "../routes/login";
import { Route as AuthenticatedRouteImport } from "../routes/_authenticated";
import { Route as IndexRouteImport } from "../routes/index";
import { Route as UsersRouteImport } from "../routes/_authenticated/users";
import { Route as StockOutRouteImport } from "../routes/_authenticated/stock-out";
import { Route as WarehouseBillsRouteImport } from "../routes/_authenticated/warehouse-bills";
import { Route as StockInRouteImport } from "../routes/_authenticated/stock-in";
import { Route as ShopsRouteImport } from "../routes/_authenticated/shops";
import { Route as ShipmentsRouteImport } from "../routes/_authenticated/shipments";
import { Route as SettingsRouteImport } from "../routes/_authenticated/settings";
import { Route as ReportsRouteImport } from "../routes/_authenticated/reports";
import { Route as RacksRouteImport } from "../routes/_authenticated/racks";
import { Route as ProductsRouteImport } from "../routes/_authenticated/products";
import { Route as OrderRequestRouteImport } from "../routes/_authenticated/order-request";
import { Route as OrderHistoryRouteImport } from "../routes/_authenticated/order-history";
import { Route as HealthRouteImport } from "../routes/_authenticated/health";
import { Route as DashboardRouteImport } from "../routes/_authenticated/dashboard";
import { Route as ChangePinRouteImport } from "../routes/_authenticated/change-pin";
import { Route as BillingHistoryRouteImport } from "../routes/_authenticated/billing-history";
import { Route as BillingRouteImport } from "../routes/_authenticated/billing";
import { Route as BackupsRouteImport } from "../routes/_authenticated/backups";
import { Route as AuditRouteImport } from "../routes/_authenticated/audit";
import { Route as RackIdRouteImport } from "../routes/_authenticated/racks_.$rackId";
import { Route as RacksPrintRouteImport } from "../routes/_authenticated/racks.print";
import { Route as RacksLabelsRouteImport } from "../routes/_authenticated/racks.labels";
import { Route as ProductIdRouteImport } from "../routes/_authenticated/products_.$productId";

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

const IndexRoute = IndexRouteImport.update({ id: "/", path: "/", getParentRoute: () => rootRouteImport } as any);
const LoginRoute = LoginRouteImport.update({ id: "/login", path: "/login", getParentRoute: () => rootRouteImport } as any);
const AuthenticatedRoute = AuthenticatedRouteImport.update({ id: "/_authenticated", getParentRoute: () => rootRouteImport } as any);

const UsersRoute = UsersRouteImport.update({ id: "/users", path: "/users", getParentRoute: () => AuthenticatedRoute } as any);
const StockOutRoute = StockOutRouteImport.update({ id: "/stock-out", path: "/stock-out", getParentRoute: () => AuthenticatedRoute } as any);
const WarehouseBillsRoute = WarehouseBillsRouteImport.update({ id: "/warehouse-bills", path: "/warehouse-bills", getParentRoute: () => AuthenticatedRoute } as any);
const StockInRoute = StockInRouteImport.update({ id: "/stock-in", path: "/stock-in", getParentRoute: () => AuthenticatedRoute } as any);
const ShopsRoute = ShopsRouteImport.update({ id: "/shops", path: "/shops", getParentRoute: () => AuthenticatedRoute } as any);
const ShipmentsRoute = ShipmentsRouteImport.update({ id: "/shipments", path: "/shipments", getParentRoute: () => AuthenticatedRoute } as any);
const SettingsRoute = SettingsRouteImport.update({ id: "/settings", path: "/settings", getParentRoute: () => AuthenticatedRoute } as any);
const ReportsRoute = ReportsRouteImport.update({ id: "/reports", path: "/reports", getParentRoute: () => AuthenticatedRoute } as any);
const RacksRoute = RacksRouteImport.update({ id: "/racks", path: "/racks", getParentRoute: () => AuthenticatedRoute } as any);
const ProductsRoute = ProductsRouteImport.update({ id: "/products", path: "/products", getParentRoute: () => AuthenticatedRoute } as any);
const OrderRequestRoute = OrderRequestRouteImport.update({ id: "/order-request", path: "/order-request", getParentRoute: () => AuthenticatedRoute } as any);
const OrderHistoryRoute = OrderHistoryRouteImport.update({ id: "/order-history", path: "/order-history", getParentRoute: () => AuthenticatedRoute } as any);
const HealthRoute = HealthRouteImport.update({ id: "/health", path: "/health", getParentRoute: () => AuthenticatedRoute } as any);
const DashboardRoute = DashboardRouteImport.update({ id: "/dashboard", path: "/dashboard", getParentRoute: () => AuthenticatedRoute } as any);
const ChangePinRoute = ChangePinRouteImport.update({ id: "/change-pin", path: "/change-pin", getParentRoute: () => AuthenticatedRoute } as any);
const BillingHistoryRoute = BillingHistoryRouteImport.update({ id: "/billing-history", path: "/billing-history", getParentRoute: () => AuthenticatedRoute } as any);
const BillingRoute = BillingRouteImport.update({ id: "/billing", path: "/billing", getParentRoute: () => AuthenticatedRoute } as any);
const BackupsRoute = BackupsRouteImport.update({ id: "/backups", path: "/backups", getParentRoute: () => AuthenticatedRoute } as any);
const AuditRoute = AuditRouteImport.update({ id: "/audit", path: "/audit", getParentRoute: () => AuthenticatedRoute } as any);
const RackIdRoute = RackIdRouteImport.update({ id: "/racks_/$rackId", path: "/racks/$rackId", getParentRoute: () => AuthenticatedRoute } as any);
const ProductIdRoute = ProductIdRouteImport.update({ id: "/products_/$productId", path: "/products/$productId", getParentRoute: () => AuthenticatedRoute } as any);

const RacksPrintRoute = RacksPrintRouteImport.update({ id: "/print", path: "/print", getParentRoute: () => RacksRoute } as any);
const RacksLabelsRoute = RacksLabelsRouteImport.update({ id: "/labels", path: "/labels", getParentRoute: () => RacksRoute } as any);
const RacksRouteWithChildren = RacksRoute._addFileChildren({ RacksPrintRoute, RacksLabelsRoute });

const AuthenticatedRouteWithChildren = AuthenticatedRoute._addFileChildren({
  AuditRoute,
  BackupsRoute,
  BillingRoute,
  BillingHistoryRoute,
  ChangePinRoute,
  DashboardRoute,
  HealthRoute,
  OrderHistoryRoute,
  OrderRequestRoute,
  ProductsRoute,
  ProductIdRoute,
  RacksRoute: RacksRouteWithChildren,
  RackIdRoute,
  ReportsRoute,
  SettingsRoute,
  ShipmentsRoute,
  ShopsRoute,
  StockInRoute,
  StockOutRoute,
  WarehouseBillsRoute,
  UsersRoute,
});

export const routeTree = rootRouteImport._addFileChildren({
  IndexRoute,
  LoginRoute,
  AuthenticatedRoute: AuthenticatedRouteWithChildren,
});
