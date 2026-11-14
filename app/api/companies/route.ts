import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

/**
 * The parts a customer buys, flattened onto the customer record.
 *
 * Only active parts are listed: a part taken out of the catalogue should stop
 * being offered on a new PO, while the link itself is left alone so nothing
 * is quietly unpicked if it comes back.
 */
const customerPartsInclude = {
  customerParts: {
    where: { part: { isActive: true } },
    orderBy: { part: { partCode: "asc" } },
    select: {
      part: { select: { id: true, partCode: true, name: true } },
    },
  },
} satisfies Prisma.CompanyInclude;

type CompanyWithParts = Prisma.CompanyGetPayload<{
  include: typeof customerPartsInclude;
}>;

function withParts({ customerParts, ...company }: CompanyWithParts) {
  return { ...company, parts: customerParts.map((link) => link.part) };
}

/**
 * The customer's part list as sent by the browser: part ids, de-duplicated,
 * and only ones that are really in the catalogue. Returns null when the
 * caller did not mention parts at all, which means "leave the list alone" -
 * an older screen posting a customer must not wipe it.
 */
async function readPartIds(raw: unknown): Promise<string[] | null> {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) return [];
  const found = await prisma.part.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true },
  });
  return found.map((p) => p.id);
}

// GET - List all companies
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canRead(session, "companies")) {
      return NextResponse.json(
        { error: "You do not have access to this data" },
        { status: 403 }
      );
    }
const companies = await prisma.company.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      include: customerPartsInclude,
    });

    return NextResponse.json({
      success: true,
      data: companies.map(withParts),
    });
  } catch (error) {
    console.error("Error fetching companies:", error);
    return NextResponse.json(
      { error: "Failed to fetch companies" },
      { status: 500 }
    );
  }
}

// POST - Create new company
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "companies")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, contactPerson, phone, email, address, city, state, pincode, gstNumber, stateCode } =
      body;

    if (!name) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    const partIds = await readPartIds(body.partIds);

    const company = await prisma.company.create({
      data: {
        ...(partIds && partIds.length > 0
          ? { customerParts: { create: partIds.map((partId) => ({ partId })) } }
          : {}),
        name,
        contactPerson: contactPerson || null,
        phone: phone || null,
        email: email || null,
        address: address || null,
        city: city || null,
        state: state || null,
        pincode: pincode || null,
        // Blank stays null rather than "": a customer whose GSTIN has not been
        // asked for reads differently from one that genuinely has none
        gstNumber: gstNumber?.trim() || null,
        stateCode: stateCode?.trim() || null,
        isActive: true,
      },
      include: customerPartsInclude,
    });

    return NextResponse.json(
      { success: true, data: withParts(company) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating company:", error);
    return NextResponse.json(
      { error: "Failed to create company" },
      { status: 500 }
    );
  }
}

// PUT - Update company
export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "companies")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      id,
      name,
      contactPerson,
      phone,
      email,
      address,
      city,
      state,
      pincode,
      gstNumber,
      stateCode,
      isActive,
    } = body;

    if (!id) {
      return NextResponse.json({ error: "Company ID is required" }, { status: 400 });
    }

    const partIds = await readPartIds(body.partIds);

    /*
     * The part list is replaced, but only the difference is written: links
     * that are still wanted are left exactly as they were, so their createdAt
     * still says when the customer first asked for that part.
     */
    const company = await prisma.$transaction(async (tx) => {
      if (partIds) {
        await tx.customerPart.deleteMany({
          where: { companyId: id, partId: { notIn: partIds.length > 0 ? partIds : [""] } },
        });
        if (partIds.length > 0) {
          await tx.customerPart.createMany({
            data: partIds.map((partId) => ({ companyId: id, partId })),
            skipDuplicates: true,
          });
        }
      }

      return tx.company.update({
        where: { id },
        data: {
          name,
        contactPerson,
        phone,
        email,
        address,
        city,
        state,
        pincode,
          gstNumber: gstNumber?.trim() || null,
          stateCode: stateCode?.trim() || null,
          isActive: isActive ?? true,
        },
        include: customerPartsInclude,
      });
    });

    return NextResponse.json({ success: true, data: withParts(company) });
  } catch (error) {
    console.error("Error updating company:", error);
    return NextResponse.json(
      { error: "Failed to update company" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete company
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    
    if (!canWrite(session, "companies")) {
      return NextResponse.json(
        { error: "You do not have permission to change this data" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Company ID is required" }, { status: 400 });
    }

    await prisma.company.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: "Company deleted" });
  } catch (error) {
    console.error("Error deleting company:", error);
    return NextResponse.json(
      { error: "Failed to delete company" },
      { status: 500 }
    );
  }
}
