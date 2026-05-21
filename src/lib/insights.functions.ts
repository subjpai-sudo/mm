import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Insight = {
  kind: "alert" | "opportunity" | "trend";
  title: string;
  detail: string;
};

export const generateStockInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ insights: Insight[]; summary: string; generatedAt: string }> => {
    const openaiKey = process.env.OPENAI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (!openaiKey && !lovableKey) {
      return {
        insights: [],
        summary: "AI insights not configured.",
        generatedAt: new Date().toISOString(),
      };
    }
    const { supabase } = context;

    const [{ data: products }, { data: movements }] = await Promise.all([
      supabase.from("products").select("id, name, stock, low_stock_threshold, rack, shelf").limit(500),
      supabase
        .from("stock_movements")
        .select("type, quantity, destination, created_at, product_id, products(name)")
        .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const prods = products ?? [];
    const moves = (movements ?? []) as any[];

    // Compact summary for the model
    const out = prods.filter((p: any) => p.stock <= 0);
    const low = prods.filter((p: any) => p.stock > 0 && p.stock <= (p.low_stock_threshold ?? 5));
    const shopTotals: Record<string, number> = {};
    const productOut: Record<string, { name: string; qty: number }> = {};
    let totalIn = 0;
    let totalOut = 0;
    for (const m of moves) {
      if (m.type === "in") totalIn += m.quantity;
      else {
        totalOut += m.quantity;
        if (m.destination) shopTotals[m.destination] = (shopTotals[m.destination] || 0) + m.quantity;
        const k = m.product_id;
        productOut[k] = productOut[k] || { name: m.products?.name ?? "?", qty: 0 };
        productOut[k].qty += m.quantity;
      }
    }
    const fastMovers = Object.values(productOut).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const shops = Object.entries(shopTotals).sort((a, b) => b[1] - a[1]);

    const factSheet = {
      window_days: 7,
      totals: { products: prods.length, out_of_stock: out.length, low_stock: low.length, units_in: totalIn, units_out: totalOut },
      out_of_stock_items: out.slice(0, 15).map((p: any) => p.name),
      low_stock_items: low.slice(0, 15).map((p: any) => ({ name: p.name, stock: p.stock, threshold: p.low_stock_threshold })),
      fast_movers_7d: fastMovers,
      shop_distribution: shops,
    };

    const system = `You are an inventory analyst for a small warehouse. Given a JSON fact sheet, return 4–6 short, concrete, actionable insights in JSON. Keep titles under 60 chars and details under 140 chars. Focus on: stock risks, restock priorities, shop imbalances, and fast-movers worth tracking. Use English.`;

    const userPrompt = `FACT SHEET:\n${JSON.stringify(factSheet)}\n\nRespond with strict JSON: {"summary": string, "insights": [{"kind":"alert"|"opportunity"|"trend","title":string,"detail":string}]}`;

    try {
      const useOpenAI = !!openaiKey;
      const endpoint = useOpenAI
        ? "https://api.openai.com/v1/chat/completions"
        : "https://ai.gateway.lovable.dev/v1/chat/completions";
      const model = useOpenAI ? "gpt-4o-mini" : "google/gemini-2.5-flash";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${useOpenAI ? openaiKey : lovableKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("[insights] gateway error", res.status, text);
        return { insights: [], summary: `AI service unavailable (${res.status}).`, generatedAt: new Date().toISOString() };
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);
      return {
        summary: String(parsed.summary ?? ""),
        insights: Array.isArray(parsed.insights) ? parsed.insights.slice(0, 6) : [],
        generatedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      console.error("[insights] failed", e);
      return { insights: [], summary: "Couldn't generate insights right now.", generatedAt: new Date().toISOString() };
    }
  });