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

/**
 * Purchase orders received FROM customers.
 *
 * The other direction - us buying ingot from a supplier - lives at
 * /api/purchase-orders. The two are different desks and different
 * permissions; nothing is shared between them but the words "purchase order".
 *
 * These orders record what has been promised. Nothing here touches stock,
 * production or the piece ledger.
 */

// GET - every order, newest first, with its lines and customer
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");
    const status = searchParams.get("status");

    const where: Prisma.CustomerOrderWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (status && status in CustomerOrderStatus) {
      where.status = status as CustomerOrderStatus;
    }

    const orders = await prisma.customerOrder.findMany({
      where,
      orderBy: [{ poDate: "desc" }, { createdAt: "desc" }],
      include: orderInclude,
    });

    return NextResponse.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error fetching customer orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer orders" },
      { status: 500 }
    );
  }
}

// POST - record a new order
export async function POST(request: NextRequest) {
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

    const body = await request.json();
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

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
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

    const order = await prisma.customerOrder.create({
      data: {
        poNumber,
        companyId,
        poDate: parseOrderDate(body.poDate) ?? new Date(),
        referenceNo: body.referenceNo?.trim() || null,
        referenceDate: parseOrderDate(body.referenceDate),
        deliveryAddress: body.deliveryAddress?.trim() || null,
        transporterName: body.transporterName?.trim() || null,
        transport: body.transport?.trim() || null,
        paymentTerms: body.paymentTerms?.trim() || null,
        specialInstructions: body.specialInstructions?.trim() || null,
        notes: body.notes?.trim() || null,
        status: (body.status as CustomerOrderStatus) || "OPEN",
        ...totals,
        createdBy: session.id,
        items: { create: items },
      },
      include: orderInclude,
    });

    return NextResponse.json({ success: true, data: order }, { status: 201 });
  } catch (error) {
    // The same customer cannot send the same PO number twice - that is a
    // re-entry of an order already on file, not a second order
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This customer already has an order with that PO number" },
        { status: 409 }
      );
    }
    console.error("Error creating customer order:", error);
    return NextResponse.json(
      { error: "Failed to create customer order" },
      { status: 500 }
    );
  }
}
