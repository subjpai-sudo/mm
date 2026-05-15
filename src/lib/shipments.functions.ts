import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminOrOwner, supabaseAdmin, writeAudit } from "./users.server";

const decisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "backordered", "declined"]),
  container_date: z.string().nullable().optional(),
  expected_arrival_date: z.string().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

export const decideOrderRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => decisionSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    const patch: Record<string, unknown> = {
      status: data.decision,
      decided_by: context.userId,
    };
    if (data.container_date !== undefined) patch.container_date = data.container_date;
    if (data.expected_arrival_date !== undefined) patch.expected_arrival_date = data.expected_arrival_date;
    if (data.product_id !== undefined) patch.product_id = data.product_id;
    if (data.category_id !== undefined) patch.category_id = data.category_id;

    const { data: row, error } = await supabaseAdmin
      .from("order_requests")
      .update(patch as any)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: `shipment.${data.decision}`,
      targetId: data.id,
      targetLabel: row?.product_name ?? null,
      details: { ...patch },
    });
    return row;
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  container_date: z.string().nullable().optional(),
  expected_arrival_date: z.string().nullable().optional(),
  product_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  product_name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().min(1).max(1_000_000).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    const { id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin
      .from("order_requests")
      .update(patch as any)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "shipment.update",
      targetId: id,
      targetLabel: row?.product_name ?? null,
      details: patch,
    });
    return row;
  });

const arriveSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(1_000_000),
});

export const markShipmentArrived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => arriveSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Admin-only
    const { data: roles } = await context.supabase
      .from("user_roles").select("role").eq("user_id", context.userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin only");

    const { data: shipment, error: shErr } = await supabaseAdmin
      .from("order_requests").select("*").eq("id", data.id).single();
    if (shErr) throw new Error(shErr.message);
    if (shipment.arrived_at) throw new Error("Shipment already marked as arrived");

    const productId = data.product_id ?? shipment.product_id;
    if (productId) {
      const { error: mvErr } = await supabaseAdmin.from("stock_movements").insert({
        product_id: productId,
        quantity: data.quantity,
        type: "in",
        reason: `Shipment arrived: ${shipment.product_name}`,
        user_id: context.userId,
      });
      if (mvErr) throw new Error(mvErr.message);
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from("order_requests")
      .update({
        arrived_at: new Date().toISOString(),
        product_id: productId,
        quantity: data.quantity,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (upErr) throw new Error(upErr.message);

    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "shipment.arrived",
      targetId: data.id,
      targetLabel: shipment.product_name,
      details: { quantity: data.quantity, product_id: productId },
    });
    return updated;
  });

const createContainerSchema = z.object({
  product_name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1_000_000),
  product_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  container_date: z.string().nullable().optional(),
  expected_arrival_date: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const logContainer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createContainerSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdminOrOwner(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("order_requests")
      .insert({
        product_name: data.product_name,
        quantity: data.quantity,
        product_id: data.product_id ?? null,
        category_id: data.category_id ?? null,
        container_date: data.container_date ?? null,
        expected_arrival_date: data.expected_arrival_date ?? null,
        notes: data.notes ?? null,
        type: "restock",
        status: "approved",
        created_by: context.userId,
        decided_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId: context.userId,
      actorEmail: context.claims?.email ?? null,
      action: "container.create",
      targetId: row.id,
      targetLabel: row.product_name,
      details: data,
    });
    return row;
  });