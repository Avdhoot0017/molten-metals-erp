import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

/**
 * Stock levels for the production form.
 *
 * The form has to show what is available to charge and refuse an over-draw,
 * but the role that runs production does not necessarily hold inventory
 * access - a production manager may charge a furnace without being able to
 * adjust stock or read the movement log.
 *
 * So this serves the one thing the form needs, the current quantity per
 * material line, gated on production access rather than inventory access. It
 * exposes no logs, no history and no way to change anything.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!canRead(session, "production")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }

    const inventory = await prisma.inventory.findMany({
      select: { type: true, quantity: true },
      orderBy: { type: "asc" },
    });

    return NextResponse.json({ success: true, data: inventory });
  } catch (error) {
    console.error("Error fetching production stock:", error);
    return NextResponse.json(
      { error: "Failed to fetch stock levels" },
      { status: 500 }
    );
  }
}
