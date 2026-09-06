import { NextRequest, NextResponse } from "next/server";
import { ALL_MATERIAL_TYPES } from "@/lib/ingot";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { AluminumType, Prisma } from "@prisma/client";

// GET - Get all inventory levels
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "inventory")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const { searchParams } = new URL(request.url);
    const { paginated, page, pageSize, skip, take } = parsePagination(searchParams);
    const type = searchParams.get("type")?.trim();
    const action = searchParams.get("action")?.trim();

    const inventory = await prisma.inventory.findMany({
      orderBy: { type: "asc" },
    });

    // The activity log is the paginated part; stock levels are only four rows
    const logWhere: Prisma.InventoryLogWhereInput = {
      ...(type && type !== "ALL" ? { type: type as AluminumType } : {}),
      ...(action && action !== "ALL" ? { action } : {}),
    };

    if (!paginated) {
      const logs = await prisma.inventoryLog.findMany({
        where: logWhere,
        take: 50,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      });
      return NextResponse.json({ success: true, data: { inventory, logs } });
    }

    const [logs, total] = await Promise.all([
      prisma.inventoryLog.findMany({
        where: logWhere,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: { user: { select: { name: true } } },
      }),
      prisma.inventoryLog.count({ where: logWhere }),
    ]);

    return NextResponse.json({
      success: true,
      data: { inventory, logs },
      pagination: buildPaginationMeta(total, { page, pageSize }),
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}

// POST - Add/Remove inventory
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "inventory")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }
const body = await request.json();
    const { type, action, quantity, notes } = body;

    if (!type || !action || !quantity) {
      return NextResponse.json(
        { error: "Type, action, and quantity are required" },
        { status: 400 }
      );
    }

    const validTypes: AluminumType[] = ALL_MATERIAL_TYPES;
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid inventory type" }, { status: 400 });
    }

    if (!["ADD", "REMOVE", "ADJUST"].includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const quantityNum = parseFloat(quantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      return NextResponse.json({ error: "Quantity must be a positive number" }, { status: 400 });
    }

    // Get current inventory
    let currentInventory = await prisma.inventory.findUnique({
      where: { type: type as AluminumType },
    });

    if (!currentInventory) {
      // Create inventory record if it doesn't exist
      currentInventory = await prisma.inventory.create({
        data: {
          type: type as AluminumType,
          quantity: 0,
        },
      });
    }

    const previousQty = currentInventory.quantity;
    let newQty: number;

    if (action === "ADD") {
      newQty = previousQty + quantityNum;
    } else if (action === "REMOVE") {
      if (quantityNum > previousQty) {
        return NextResponse.json(
          { error: "Cannot remove more than available quantity" },
          { status: 400 }
        );
      }
      newQty = previousQty - quantityNum;
    } else {
      // ADJUST - set to exact value
      newQty = quantityNum;
    }

    // Update inventory
    const updatedInventory = await prisma.inventory.update({
      where: { type: type as AluminumType },
      data: {
        quantity: newQty,
        lastUpdated: new Date(),
      },
    });

    // Create log entry
    await prisma.inventoryLog.create({
      data: {
        type: type as AluminumType,
        action,
        quantity: action === "REMOVE" ? -quantityNum : quantityNum,
        previousQty,
        newQty,
        notes: notes || null,
        createdBy: session.id,
      },
    });

    return NextResponse.json({ success: true, data: updatedInventory });
  } catch (error) {
    console.error("Error updating inventory:", error);
    return NextResponse.json(
      { error: "Failed to update inventory" },
      { status: 500 }
    );
  }
}
