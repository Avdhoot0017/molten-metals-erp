import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canReverseOutward } from "@/lib/permissions";
import { READY_STAGE, addMove, applyStageMoves, type StageMoves } from "@/lib/pieces";

/**
 * DELETE - cancel an outward note.
 *
 * The pieces go back into finished stock, because that is where they are if
 * the lorry never left. Deleting the row without reversing the movement would
 * leave stock permanently short with nothing to explain it - the exact
 * failure the piece ledger exists to prevent - so the two happen together or
 * not at all.
 *
 * Admin only: this restates a signed delivery note.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/customer-outward/[id]">
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canReverseOutward(session)) {
      return NextResponse.json(
        { error: "Only an admin can cancel an outward note" },
        { status: 403 }
      );
    }

    const { id } = await ctx.params;
    const dispatch = await prisma.dispatch.findUnique({
      where: { id },
      include: {
        items: { select: { partId: true, quantity: true } },
        company: { select: { name: true } },
      },
    });

    if (!dispatch) {
      return NextResponse.json({ error: "Outward note not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      const moves: StageMoves = new Map();
      for (const item of dispatch.items) {
        addMove(moves, item.partId, READY_STAGE, item.quantity);
      }

      // Putting pieces back can never send a stage negative, so this cannot
      // be refused - it is called for the log it writes as much as the move
      await applyStageMoves(tx, moves, {
        reference: "DISPATCH",
        referenceId: dispatch.id,
        notes: `Cancelled outward ${dispatch.dispatchNumber} to ${dispatch.company.name}`,
        userId: session.id,
        describe: () => "finished stock",
        partLabel: (partId) => partId,
      });

      await tx.dispatch.delete({ where: { id } });
    });

    return NextResponse.json({
      success: true,
      message: `Outward ${dispatch.dispatchNumber} cancelled and the pieces put back into finished stock`,
    });
  } catch (error) {
    console.error("Error cancelling outward note:", error);
    return NextResponse.json(
      { error: "Failed to cancel this outward note" },
      { status: 500 }
    );
  }
}
