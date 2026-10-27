import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { Prisma, CustomerOrderStatus } from "@prisma/client";
import {
  normaliseItems,
  orderInclude,
  parseOrderDate,
  ItemsRefused,
} from "@/lib/customer-order-api";
import { orderTotals } from "@/lib/customer-orders";

// GET - one order with its lines
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/customer-orders/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const order = await prisma.customerOrder.findUnique({
      where: { id },
      include: orderInclude,
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    console.error("Error fetching customer order:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer order" },
      { status: 500 }
    );
  }
}

/**
 * PUT - re-record an order.
 *
 * The lines are replaced wholesale rather than patched: an amended PO arrives
 * as a fresh sheet of paper and is re-keyed from it, and matching up which of
 * our rows each of their rows corresponds to would be guesswork. Nothing
 * downstream points at a line, so replacing them breaks no reference.
 */
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/customer-orders/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const existing = await prisma.customerOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const body = await request.json();

    // A status-only change - the common edit from the list - leaves the
    // paperwork alone
    if (body.statusOnly) {
      const status = body.status as CustomerOrderStatus;
      if (!status || !(status in CustomerOrderStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      const updated = await prisma.customerOrder.update({
        where: { id },
        data: { status },
        include: orderInclude,
      });
      return NextResponse.json({ success: true, data: updated });
    }

    const poNumber = String(body.poNumber ?? "").trim();
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json(
        { error: "Choose the customer this order came from" },
        { status: 400 }
      );
    }
    if (!poNumber) {
      return NextResponse.json(
        { error: "The customer's PO number is required" },
        { status: 400 }
      );
    }

    let items;
    try {
      items = normaliseItems(body.items);
    } catch (error) {
      if (error instanceof ItemsRefused) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const totals = orderTotals(items);

    const order = await prisma.$transaction(async (tx) => {
      await tx.customerOrderItem.deleteMany({ where: { orderId: id } });
      return tx.customerOrder.update({
        where: { id },
        data: {
          poNumber,
          companyId,
          poDate: parseOrderDate(body.poDate) ?? existing.poDate,
          referenceNo: body.referenceNo?.trim() || null,
          referenceDate: parseOrderDate(body.referenceDate),
          deliveryAddress: body.deliveryAddress?.trim() || null,
          transporterName: body.transporterName?.trim() || null,
          transport: body.transport?.trim() || null,
          paymentTerms: body.paymentTerms?.trim() || null,
          specialInstructions: body.specialInstructions?.trim() || null,
          notes: body.notes?.trim() || null,
          status: (body.status as CustomerOrderStatus) || existing.status,
          ...totals,
          items: { create: items },
        },
        include: orderInclude,
      });
    });

    return NextResponse.json({ success: true, data: order });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This customer already has an order with that PO number" },
        { status: 409 }
      );
    }
    console.error("Error updating customer order:", error);
    return NextResponse.json(
      { error: "Failed to update customer order" },
      { status: 500 }
    );
  }
}

/**
 * DELETE - remove an order that was entered in error.
 *
 * A hard delete, lines and all: an order recorded by mistake is not history,
 * and nothing anywhere else points at it. An order that was placed and then
 * withdrawn should be set to CANCELLED instead, which keeps the record.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/customer-orders/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canWrite(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const existing = await prisma.customerOrder.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await prisma.customerOrder.delete({ where: { id } });

    return NextResponse.json({ success: true, message: "Order deleted" });
  } catch (error) {
    console.error("Error deleting customer order:", error);
    return NextResponse.json(
      { error: "Failed to delete customer order" },
      { status: 500 }
    );
  }
}
