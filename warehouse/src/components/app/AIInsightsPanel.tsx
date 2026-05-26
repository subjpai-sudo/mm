import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generateStockInsights } from "@/lib/insights.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, TrendingUp, Lightbulb, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const KIND_META = {
  alert: { Icon: AlertTriangle, cls: "text-destructive bg-destructive/10 border-destructive/30" },
  opportunity: { Icon: Lightbulb, cls: "text-success bg-success/10 border-success/30" },
  trend: { Icon: TrendingUp, cls: "text-primary bg-primary/10 border-primary/30" },
} as const;

export function AIInsightsPanel() {
  const fn = useServerFn(generateStockInsights);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["ai-insights"],
    queryFn: () => fn({ data: undefined as any }),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card className="card-elevated p-5 relative overflow-hidden">
      <div className="absolute -top-16 -right-16 size-48 rounded-full bg-gradient-to-br from-accent/40 to-primary/0 blur-3xl opacity-70 pointer-events-none" />
      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl gradient-primary grid place-items-center">
            <Sparkles className="size-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-semibold tracking-tight">AI insights</h2>
            <p className="text-[11px] text-muted-foreground">
              {data?.generatedAt
                ? `Updated ${formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}`
                : "Analyzing your stock…"}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {data?.summary && (
        <p className="relative text-sm text-foreground/80 mb-3 leading-relaxed">{data.summary}</p>
      )}

      {isFetching && !data && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-secondary/50 animate-pulse" />
          ))}
        </div>
      )}

      <div className="relative grid sm:grid-cols-2 gap-2">
        {(data?.insights ?? []).map((ins, i) => {
          const meta = KIND_META[ins.kind] ?? KIND_META.trend;
          return (
            <div key={i} className={cn("rounded-xl border p-3", meta.cls)}>
              <div className="flex items-start gap-2">
                <meta.Icon className="size-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-snug">{ins.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{ins.detail}</div>
                </div>
              </div>
            </div>
          );
        })}
        {!isFetching && (data?.insights?.length ?? 0) === 0 && (
          <div className="sm:col-span-2 text-center text-sm text-muted-foreground py-6">
            No insights yet — try again in a moment.
          </div>
        )}
      </div>
    </Card>
  );
}