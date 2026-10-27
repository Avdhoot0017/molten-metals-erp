import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { READY_STAGE, addMove, applyStageMoves, type StageMoves } from "@/lib/pieces";
import { nextOutwardNumber, outwardPrefix, outwardWeight } from "@/lib/outward";
import { EXCLUDED_ORDER_STATUS } from "@/lib/demand";
import { Prisma } from "@prisma/client";

/**
 * Customer outward - finished castings leaving the yard.
 *
 * This is the far end of the piece ledger. Pouring creates pieces, the
 * benches move them along, and an outward note is the only thing that takes
 * them out of finished stock. Recording one therefore MOVES pieces rather
 * than just noting them, which is what keeps "what is on the shelf" worth
 * reading.
 *
 * Refused rather than fudged: you cannot send out more pieces than are
 * finished. The alternative is a negative stock figure, which is the
 * double-counting bug wearing a different hat.
 */

/** A dispatch that cannot be recorded, with the reason the shop would give. */
class OutwardRefused extends Error {}

const dispatchInclude = {
  company: { select: { id: true, name: true, gstNumber: true, city: true } },
  customerOrder: { select: { id: true, poNumber: true } },
  user: { select: { name: true } },
  supervisor: { select: { id: true, employeeCode: true, name: true } },
  qcCheckedBy: { select: { id: true, employeeCode: true, name: true } },
  items: {
    include: {
      part: { select: { id: true, partCode: true, name: true, weightPerPiece: true } },
    },
  },
} satisfies Prisma.DispatchInclude;

// GET - customer by customer: what they ordered, what is finished, what went
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /*
     * Follows access to customer orders, which is what makes this readable by
     * Accounts: they answer for what has been invoiced and what is still
     * owed, and that question is this page.
     */
    if (!canRead(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const companyFilter = searchParams.get("companyId");

    const [customers, orderLines, dispatches, readyRows] = await Promise.all([
      prisma.company.findMany({
        where: { isActive: true, ...(companyFilter ? { id: companyFilter } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, gstNumber: true, city: true, state: true },
      }),

      prisma.customerOrderItem.findMany({
        where: {
          partId: { not: null },
          order: {
            status: { not: EXCLUDED_ORDER_STATUS },
            ...(companyFilter ? { companyId: companyFilter } : {}),
          },
        },
        select: {
          partId: true,
          quantity: true,
          itemCode: true,
          order: {
            select: { companyId: true, poNumber: true, poDate: true, status: true },
          },
          part: { select: { partCode: true, name: true, weightPerPiece: true } },
        },
      }),

      prisma.dispatch.findMany({
        where: companyFilter ? { companyId: companyFilter } : undefined,
        orderBy: [{ dispatchDate: "desc" }, { createdAt: "desc" }],
        include: dispatchInclude,
      }),

      // Finished stock is held per part, not per customer - a casting on the
      // shelf is not promised to anybody until it is loaded
      prisma.partStage.findMany({
        where: { kind: "READY", quantity: { not: 0 } },
        select: { partId: true, quantity: true },
      }),
    ]);

    const readyByPart = new Map(readyRows.map((row) => [row.partId, row.quantity]));

    interface CustomerPartRow {
      partId: string;
      partCode: string;
      name: string;
      weightPerPiece: number;
      ordered: number;
      dispatched: number;
      orders: Set<string>;
    }

    const byCustomer = new Map<string, Map<string, CustomerPartRow>>();

    const rowFor = (
      companyId: string,
      partId: string,
      part: { partCode: string; name: string; weightPerPiece: number }
    ) => {
      const parts = byCustomer.get(companyId) ?? new Map<string, CustomerPartRow>();
      const row =
        parts.get(partId) ??
        {
          partId,
          partCode: part.partCode,
          name: part.name,
          weightPerPiece: part.weightPerPiece,
          ordered: 0,
          dispatched: 0,
          orders: new Set<string>(),
        };
      parts.set(partId, row);
      byCustomer.set(companyId, parts);
      return row;
    };

    for (const line of orderLines) {
      if (!line.partId || !line.part) continue;
      const row = rowFor(line.order.companyId, line.partId, line.part);
      row.ordered += Math.round(line.quantity);
      row.orders.add(line.order.poNumber);
    }

    for (const dispatch of dispatches) {
      for (const item of dispatch.items) {
        const row = rowFor(dispatch.companyId, item.partId, item.part);
        row.dispatched += item.quantity;
      }
    }

    const rows = customers.map((customer) => {
      const parts = [...(byCustomer.get(customer.id)?.values() ?? [])].map(
        (row) => ({
          partId: row.partId,
          partCode: row.partCode,
          name: row.name,
          ordered: row.ordered,
          dispatched: row.dispatched,
          outstanding: Math.max(0, row.ordered - row.dispatched),
          /*
           * Finished stock of this part across the whole shop. Shown so the
           * office can see whether an outstanding line can be loaded today -
           * it is NOT reserved for this customer, and is labelled that way
           * on screen.
           */
          readyInStock: readyByPart.get(row.partId) ?? 0,
          orders: row.orders.size,
          weightPerPiece: row.weightPerPiece,
        })
      );

      parts.sort((a, b) => b.outstanding - a.outstanding || b.ordered - a.ordered);

      const dispatchesForCustomer = dispatches.filter(
        (d) => d.companyId === customer.id
      );

      return {
        ...customer,
        parts,
        ordered: parts.reduce((sum, p) => sum + p.ordered, 0),
        dispatched: parts.reduce((sum, p) => sum + p.dispatched, 0),
        outstanding: parts.reduce((sum, p) => sum + p.outstanding, 0),
        canLoadNow: parts.reduce(
          (sum, p) => sum + Math.min(p.outstanding, p.readyInStock),
          0
        ),
        dispatchCount: dispatchesForCustomer.length,
        lastDispatchDate: dispatchesForCustomer[0]?.dispatchDate ?? null,
      };
    });

    // Customers with nothing on either side are not interesting here
    const active = rows.filter(
      (row) => row.ordered > 0 || row.dispatched > 0 || row.dispatchCount > 0
    );

    return NextResponse.json({
      success: true,
      data: {
        customers: active,
        /** Every customer, for the pickers - including those with no history. */
        allCustomers: customers,
        dispatches: dispatches.map((dispatch) => ({
          id: dispatch.id,
          dispatchNumber: dispatch.dispatchNumber,
          dispatchDate: dispatch.dispatchDate,
          company: dispatch.company,
          customerOrder: dispatch.customerOrder,
          vehicleNumber: dispatch.vehicleNumber,
          driverName: dispatch.driverName,
          invoiceNumber: dispatch.invoiceNumber,
          supervisor: dispatch.supervisor,
          qcCheckedBy: dispatch.qcCheckedBy,
          notes: dispatch.notes,
          recordedBy: dispatch.user?.name ?? null,
          items: dispatch.items.map((item) => ({
            id: item.id,
            partId: item.partId,
            partCode: item.part.partCode,
            name: item.part.name,
            quantity: item.quantity,
            weight: item.weight,
          })),
          totalPieces: dispatch.items.reduce((sum, i) => sum + i.quantity, 0),
          totalWeight: dispatch.items.reduce((sum, i) => sum + i.weight, 0),
        })),
        readyStock: readyRows.map((row) => ({
          partId: row.partId,
          ready: row.quantity,
        })),
      },
    });
  } catch (error) {
    console.error("Error loading customer outward:", error);
    return NextResponse.json(
      { error: "Failed to load customer outward" },
      { status: 500 }
    );
  }
}

// POST - record castings going out
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canWrite(session, "customerOrders")) {
      return NextResponse.json(
        { error: "You do not have permission to record a dispatch" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const companyId = String(body.companyId ?? "").trim();
    if (!companyId) {
      return NextResponse.json(
        { error: "Choose the customer this is going to" },
        { status: 400 }
      );
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const dispatchDate = body.dispatchDate ? new Date(body.dispatchDate) : new Date();
    if (Number.isNaN(dispatchDate.getTime())) {
      return NextResponse.json({ error: "Invalid dispatch date" }, { status: 400 });
    }

    // Lines, cleaned up and added together: the same part twice on one note
    // is one line, not two chances to take the stock down separately
    const byPart = new Map<string, number>();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const partId = String(raw?.partId ?? "").trim();
      const quantity = Math.floor(Number(raw?.quantity ?? 0));
      if (!partId || !Number.isFinite(quantity) || quantity <= 0) continue;
      byPart.set(partId, (byPart.get(partId) ?? 0) + quantity);
    }

    if (byPart.size === 0) {
      return NextResponse.json(
        { error: "Add at least one part, with how many pieces are going" },
        { status: 400 }
      );
    }

    const parts = await prisma.part.findMany({
      where: { id: { in: [...byPart.keys()] } },
      select: { id: true, partCode: true, name: true, weightPerPiece: true },
    });
    if (parts.length !== byPart.size) {
      return NextResponse.json({ error: "One of the parts was not found" }, { status: 404 });
    }
    const partById = new Map(parts.map((p) => [p.id, p]));

    // An order can only be delivered against if it belongs to this customer
    const customerOrderId = body.customerOrderId
      ? String(body.customerOrderId)
      : null;
    if (customerOrderId) {
      const order = await prisma.customerOrder.findUnique({
        where: { id: customerOrderId },
        select: { companyId: true },
      });
      if (!order || order.companyId !== companyId) {
        return NextResponse.json(
          { error: "That order does not belong to this customer" },
          { status: 400 }
        );
      }
    }

    /*
     * Supervisor and QC checker. Both optional on the request, but when a name
     * is sent it has to be a real employee who is still on the books - a note
     * that says a casting was passed by somebody who does not exist is worse
     * than one that says nothing.
     */
    const supervisorId = body.supervisorId ? String(body.supervisorId) : null;
    const qcCheckedById = body.qcCheckedById ? String(body.qcCheckedById) : null;
    const namedIds = [supervisorId, qcCheckedById].filter(
      (id): id is string => id !== null
    );
    if (namedIds.length > 0) {
      const found = await prisma.employee.findMany({
        where: { id: { in: [...new Set(namedIds)] }, isActive: true },
        select: { id: true },
      });
      const alive = new Set(found.map((e) => e.id));
      if (supervisorId && !alive.has(supervisorId)) {
        return NextResponse.json(
          { error: "That dispatch supervisor is not an active employee" },
          { status: 400 }
        );
      }
      if (qcCheckedById && !alive.has(qcCheckedById)) {
        return NextResponse.json(
          { error: "That quality checker is not an active employee" },
          { status: 400 }
        );
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      // The number is taken inside the transaction so two notes written at
      // the same moment cannot be handed the same one
      const existing = await tx.dispatch.findMany({
        where: { dispatchNumber: { startsWith: outwardPrefix(dispatchDate) } },
        select: { dispatchNumber: true },
      });
      const supplied = String(body.dispatchNumber ?? "").trim();
      const dispatchNumber =
        supplied || nextOutwardNumber(existing.map((d) => d.dispatchNumber), dispatchDate);

      const dispatch = await tx.dispatch.create({
        data: {
          dispatchNumber,
          companyId,
          customerOrderId,
          dispatchDate,
          vehicleNumber: body.vehicleNumber?.trim() || null,
          driverName: body.driverName?.trim() || null,
          invoiceNumber: body.invoiceNumber?.trim() || null,
          supervisorId,
          qcCheckedById,
          notes: body.notes?.trim() || null,
          createdBy: session.id,
          items: {
            create: [...byPart.entries()].map(([partId, quantity]) => ({
              partId,
              quantity,
              weight: outwardWeight(
                quantity,
                partById.get(partId)?.weightPerPiece ?? 0
              ),
            })),
          },
        },
        include: dispatchInclude,
      });

      // Take the pieces out of finished stock
      const moves: StageMoves = new Map();
      for (const [partId, quantity] of byPart) {
        addMove(moves, partId, READY_STAGE, -quantity);
      }

      const refusal = await applyStageMoves(tx, moves, {
        reference: "DISPATCH",
        referenceId: dispatch.id,
        notes: `Sent to ${company.name} on ${dispatchNumber}`,
        userId: session.id,
        describe: () => "finished stock",
        partLabel: (partId) => partById.get(partId)?.partCode ?? "this part",
      });

      if (refusal) throw new OutwardRefused(refusal);

      return dispatch;
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof OutwardRefused) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "That outward number has already been used" },
        { status: 409 }
      );
    }
    console.error("Error recording dispatch:", error);
    return NextResponse.json(
      { error: "Failed to record this dispatch" },
      { status: 500 }
    );
  }
}
