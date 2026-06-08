import { createServerFn } from "@tanstack/start-client-core";
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
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!openaiKey && !geminiKey) {
      return { insights: [], summary: "AI insights not configured.", generatedAt: new Date().toISOString() };
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

    const systemPrompt = `You are an inventory analyst for a small warehouse. Given a JSON fact sheet, return 4–6 short, concrete, actionable insights in JSON. Keep titles under 60 chars and details under 140 chars. Focus on: stock risks, restock priorities, shop imbalances, and fast-movers worth tracking. Use English.`;
    const userPrompt = `FACT SHEET:\n${JSON.stringify(factSheet)}\n\nRespond with strict JSON: {"summary": string, "insights": [{"kind":"alert"|"opportunity"|"trend","title":string,"detail":string}]}`;

    try {
      let raw = "";

      // --- Try OpenAI first ---
      if (openaiKey) {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          raw = json?.choices?.[0]?.message?.content ?? "";
        } else {
          console.error("[insights] openai error", res.status, await res.text().catch(() => ""));
        }
      }

      // --- Fallback to Gemini ---
      if (!raw && geminiKey) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: "application/json" },
            }),
          }
        );
        if (res.ok) {
          const aiRes = await res.json();
          raw = aiRes?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        } else {
          console.error("[insights] gemini error", res.status, await res.text().catch(() => ""));
          return { insights: [], summary: `AI service unavailable (${res.status}).`, generatedAt: new Date().toISOString() };
        }
      }

      if (!raw) return { insights: [], summary: "No AI response received.", generatedAt: new Date().toISOString() };

      const parsed = JSON.parse(raw);
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
