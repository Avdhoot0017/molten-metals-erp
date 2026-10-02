import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

/**
 * Metal sitting in a furnace, waiting to be melted into the next heat.
 *
 * A batch that did not pour everything it was charged with leaves a heel
 * behind. It counts from the moment its castings are counted, not from when
 * the batch is finally closed: the metal is physically in the furnace as soon
 * as pouring stops, and weighing the scrap afterwards is paperwork that does
 * not move it.
 *
 * It stays claimable until some later batch takes it - once claimed it
 * disappears from here, because the same metal cannot go into two heats.
 *
 * Kept separate from the batch list so the create form can ask a short,
 * specific question ("what is still in this furnace?") without paging through
 * production history.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canRead(session, "production")) {
      return NextResponse.json(
        { error: "You do not have permission to view this data" },
        { status: 403 }
      );
    }

    const furnaceId = request.nextUrl.searchParams.get("furnaceId");

    const heels = await prisma.productionRecord.findMany({
      where: {
        metalRemaining: { gt: 0 },
        // Unclaimed only
        carriedTo: { is: null },
        ...(furnaceId ? { furnaceId } : {}),
      },
      select: {
        id: true,
        batchNumber: true,
        date: true,
        metalRemaining: true,
        ingotGrade: true,
        // So the form can say the batch it comes from is still open
        status: true,
        furnaceId: true,
        furnace: { select: { id: true, name: true } },
      },
      // Newest first: the metal most likely still hot is the one being asked about
      orderBy: { date: "desc" },
      take: 20,
    });

    return NextResponse.json({ success: true, data: heels });
  } catch (error) {
    console.error("Error fetching furnace heels:", error);
    return NextResponse.json(
      { error: "Failed to fetch what is left in the furnaces" },
      { status: 500 }
    );
  }
}
