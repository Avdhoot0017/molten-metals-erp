import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { POStatus } from "@prisma/client";
import { isIngotType } from "@/lib/ingot";
import type { AluminumType } from "@/types";

// Helper to generate PO number
function generatePONumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `PO-${year}${month}-${random}`;
}

// GET - List all purchase orders
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "purchaseOrders")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const orders = await prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        supplier: {
          select: {
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            address: true,
            gstNumber: true,
          },
        },
        user: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: orders });
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    return NextResponse.json(
      { error: "Failed to fetch purchase orders" },
      { status: 500 }
    );
  }
}

// POST - Create new purchase order
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "purchaseOrders")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
const body = await request.json();
    const { supplierId, quantity, pricePerKg, expectedDate, notes, ingotType } = body;

    if (!supplierId || !quantity || !pricePerKg) {
      return NextResponse.json(
        { error: "Supplier, quantity, and price are required" },
        { status: 400 }
      );
    }

    // An order is raised for one ingot grade; delivery credits that grade's stock
    const orderIngotType: AluminumType = ingotType ?? "INGOT_LM6";
    if (!isIngotType(orderIngotType)) {
      return NextResponse.json(
        { error: "Choose the ingot grade being ordered" },
        { status: 400 }
      );
    }

    const quantityNum = parseFloat(quantity);
    const priceNum = parseFloat(pricePerKg);
    const totalAmount = (quantityNum / 1000) * priceNum; // Convert grams to kg for price calculation

    // Verify supplier exists
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Generate unique PO number
    let poNumber = generatePONumber();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { poNumber },
      });
      if (!existing) break;
      poNumber = generatePONumber();
      attempts++;
    }

    const order = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId,
        quantity: quantityNum,
        ingotType: orderIngotType,
        pricePerKg: priceNum,
        totalAmount,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes: notes || null,
        status: "PENDING",
        createdBy: session.id,
      },
      include: {
        supplier: {
          select: {
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            address: true,
            gstNumber: true,
          },
        },
        user: {
          select: { name: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: order }, { status: 201 });
  } catch (error) {
    console.error("Error creating purchase order:", error);
    return NextResponse.json(
      { error: "Failed to create purchase order" },
      { status: 500 }
    );
  }
}

// PUT - Update purchase order status
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "purchaseOrders")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
const body = await request.json();
    const { id, status, deliveredDate } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "Order ID and status are required" },
        { status: 400 }
      );
    }

    const validStatuses: POStatus[] = ["PENDING", "CONFIRMED", "IN_TRANSIT", "DELIVERED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // If marking as delivered, add to ingot inventory
    if (status === "DELIVERED" && order.status !== "DELIVERED") {
      await prisma.$transaction(async (tx) => {
        // Update order
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            status,
            deliveredDate: deliveredDate ? new Date(deliveredDate) : new Date(),
          },
        });

        // Get current ingot inventory
        const ingotInventory = await tx.inventory.findUnique({
          where: { type: order.ingotType },
        });

        const previousQty = ingotInventory?.quantity || 0;
        const newQty = previousQty + order.quantity;

        // Update ingot inventory
        await tx.inventory.upsert({
          where: { type: order.ingotType },
          update: {
            quantity: { increment: order.quantity },
            lastUpdated: new Date(),
          },
          create: {
            type: order.ingotType,
            quantity: order.quantity,
          },
        });

        // Log inventory change
        await tx.inventoryLog.create({
          data: {
            type: order.ingotType,
            action: "ADD",
            quantity: order.quantity,
            previousQty,
            newQty,
            reference: "PurchaseOrder",
            referenceId: order.id,
            notes: `Received from PO ${order.poNumber}`,
            createdBy: session.id,
          },
        });
      });

      const updatedOrder = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: {
            select: {
              name: true,
              contactPerson: true,
              phone: true,
              email: true,
              address: true,
              gstNumber: true,
            },
          },
          user: { select: { name: true } },
        },
      });

      return NextResponse.json({ success: true, data: updatedOrder });
    }

    // Regular status update
    const updatedOrder = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status,
        deliveredDate: deliveredDate ? new Date(deliveredDate) : undefined,
      },
      include: {
        supplier: {
          select: {
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            address: true,
            gstNumber: true,
          },
        },
        user: { select: { name: true } },
      },
    });

    return NextResponse.json({ success: true, data: updatedOrder });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    return NextResponse.json(
      { error: "Failed to update purchase order" },
      { status: 500 }
    );
  }
}
