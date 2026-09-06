import { PrismaClient } from "@prisma/client";
import type { AluminumType } from "@/types";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

// Create Prisma client with adapter for Prisma 7
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Helper to generate dates relative to today
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  console.log("🚀 Starting database seed...\n");

  // Clear existing data (optional - comment out if you want to preserve data)
  console.log("🧹 Clearing existing data...");
  await prisma.fettlingActivity.deleteMany();
  await prisma.furnace.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.activityType.deleteMany();
  await prisma.inventoryLog.deleteMany();
  await prisma.productionRecord.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.part.deleteMany();
  await prisma.company.deleteMany();
  await prisma.supplier.deleteMany();
  // Don't delete users to preserve login credentials

  // =====================
  // USERS
  // =====================
  console.log("\n👤 Creating users...");

  const adminPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@moltenmetals.com" },
    update: {},
    create: {
      email: "admin@moltenmetals.com",
      password: adminPassword,
      name: "Rajesh Kumar",
      role: "ADMIN",
      isActive: true,
    },
  });

  const productionManagerPassword = await bcrypt.hash("production123", 12);
  const plantHead = await prisma.user.upsert({
    where: { email: "production@moltenmetals.com" },
    update: {},
    create: {
      email: "production@moltenmetals.com",
      password: productionManagerPassword,
      name: "Sunil Patil",
      role: "PRODUCTION_MANAGER",
      isActive: true,
    },
  });

  const fettlingManagerPassword = await bcrypt.hash("fettling123", 12);
  const fettlingManager = await prisma.user.upsert({
    where: { email: "fettling@moltenmetals.com" },
    update: {},
    create: {
      email: "fettling@moltenmetals.com",
      password: fettlingManagerPassword,
      name: "Anil Deshmukh",
      role: "FETTLING_MANAGER",
      isActive: true,
    },
  });

  const accountsPassword = await bcrypt.hash("accounts123", 12);
  const accounts = await prisma.user.upsert({
    where: { email: "accounts@moltenmetals.com" },
    update: {},
    create: {
      email: "accounts@moltenmetals.com",
      password: accountsPassword,
      name: "Meera Joshi",
      role: "ACCOUNTS",
      isActive: true,
    },
  });

  console.log(`   ✓ Created admin: ${admin.email}`);
  console.log(`   ✓ Created production manager: ${plantHead.email}`);
  console.log(`   ✓ Created accounts: ${accounts.email}`);
  console.log(`   ✓ Created fettling manager: ${fettlingManager.email}`);

  // =====================
  // SUPPLIERS
  // =====================
  console.log("\n🏭 Creating suppliers...");

  const suppliersData = [
    {
      id: "supplier-1",
      name: "Hindustan Aluminium Corp",
      contactPerson: "Ramesh Agarwal",
      phone: "+91 98765 43210",
      email: "sales@hindalco.in",
      address: "Plot No. 45, Industrial Area Phase 1, Pune, Maharashtra - 411057",
      gstNumber: "27AABCU9603R1ZM",
    },
    {
      id: "supplier-2",
      name: "National Metal Suppliers",
      contactPerson: "Amit Deshmukh",
      phone: "+91 87654 32109",
      email: "orders@nationalmetals.com",
      address: "Survey No. 123, GIDC Estate, Ahmedabad, Gujarat - 382415",
      gstNumber: "24AABCM1234R1Z5",
    },
    {
      id: "supplier-3",
      name: "Balaji Aluminium Works",
      contactPerson: "Venkatesh Iyer",
      phone: "+91 76543 21098",
      email: "balaji.aluminium@gmail.com",
      address: "MIDC Industrial Area, Aurangabad, Maharashtra - 431136",
      gstNumber: "27AABCP5678R1Z8",
    },
    {
      id: "supplier-4",
      name: "Gujarat Metal Industries",
      contactPerson: "Mehul Shah",
      phone: "+91 99887 76655",
      email: "mehul@gujaratmetals.in",
      address: "Plot 78, Sanand GIDC, Ahmedabad, Gujarat - 382110",
      gstNumber: "24AABCG9012R1Z3",
    },
    {
      id: "supplier-5",
      name: "Shree Ganesh Metals",
      contactPerson: "Prakash Joshi",
      phone: "+91 88776 65544",
      email: "shreegmetal@yahoo.com",
      address: "Bhosari MIDC, Pune, Maharashtra - 411026",
      gstNumber: "27AABCS3456R1Z1",
    },
  ];

  const suppliers = await Promise.all(
    suppliersData.map((s) =>
      prisma.supplier.create({
        data: { ...s, isActive: true },
      })
    )
  );
  console.log(`   ✓ Created ${suppliers.length} suppliers`);

  // =====================
  // COMPANIES
  // =====================
  console.log("\n🏢 Creating companies...");

  const companiesData = [
    {
      id: "company-1",
      name: "Tata AutoComp Systems Ltd",
      contactPerson: "Vikram Singh Rathore",
      phone: "+91 98765 11111",
      email: "vikram.rathore@tatacomp.com",
      address: "Plot 45, Chakan Industrial Area",
      city: "Pune",
      state: "Maharashtra",
      pincode: "410501",
    },
    {
      id: "company-2",
      name: "Mahindra CIE Automotive",
      contactPerson: "Priya Sharma",
      phone: "+91 87654 22222",
      email: "priya.sharma@mahindracie.com",
      address: "Nashik-Pune Highway, Chakan",
      city: "Pune",
      state: "Maharashtra",
      pincode: "410507",
    },
    {
      id: "company-3",
      name: "Bosch Limited",
      contactPerson: "Rajendra Kulkarni",
      phone: "+91 76543 33333",
      email: "rajendra.kulkarni@bosch.in",
      address: "123, Hosur Road",
      city: "Bangalore",
      state: "Karnataka",
      pincode: "560095",
    },
    {
      id: "company-4",
      name: "Sundaram Clayton Ltd",
      contactPerson: "Arun Krishnamurthy",
      phone: "+91 98123 44444",
      email: "arun.k@sundaramclayton.com",
      address: "Padi Industrial Estate",
      city: "Chennai",
      state: "Tamil Nadu",
      pincode: "600050",
    },
    {
      id: "company-5",
      name: "Endurance Technologies",
      contactPerson: "Deepak Jain",
      phone: "+91 87234 55555",
      email: "deepak.jain@endurance.in",
      address: "E-92, MIDC Waluj",
      city: "Aurangabad",
      state: "Maharashtra",
      pincode: "431136",
    },
    {
      id: "company-6",
      name: "Varroc Engineering Ltd",
      contactPerson: "Sandeep Gokhale",
      phone: "+91 76345 66666",
      email: "sandeep.gokhale@varroc.com",
      address: "L-4, MIDC Five Star",
      city: "Aurangabad",
      state: "Maharashtra",
      pincode: "431210",
    },
    {
      id: "company-7",
      name: "Bharat Forge Limited",
      contactPerson: "Ashok Kadam",
      phone: "+91 98456 77777",
      email: "ashok.kadam@bharatforge.com",
      address: "Mundhwa, Pune-Nagar Road",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411036",
    },
    {
      id: "company-8",
      name: "Minda Industries Ltd",
      contactPerson: "Naveen Gupta",
      phone: "+91 87567 88888",
      email: "naveen.gupta@minda.co.in",
      address: "Plot 35, Sector 6, IMT Manesar",
      city: "Gurugram",
      state: "Haryana",
      pincode: "122050",
    },
  ];

  const companies = await Promise.all(
    companiesData.map((c) =>
      prisma.company.create({
        data: { ...c, isActive: true },
      })
    )
  );
  console.log(`   ✓ Created ${companies.length} companies`);

  // =====================
  // PARTS
  // =====================
  console.log("\n⚙️  Creating parts...");

  const partsData = [
    {
      partCode: "ENG-BLK-001",
      name: "Engine Block Type A",
      description: "4-cylinder aluminum engine block for passenger vehicles",
      weightPerPiece: 2500,
      expectedScrap: 15,
    },
    {
      partCode: "ENG-BLK-002",
      name: "Engine Block Type B",
      description: "6-cylinder aluminum engine block for SUVs",
      weightPerPiece: 3200,
      expectedScrap: 16,
    },
    {
      partCode: "CYL-HD-001",
      name: "Cylinder Head 4-Valve",
      description: "High-performance 4-valve cylinder head",
      weightPerPiece: 1800,
      expectedScrap: 12,
    },
    {
      partCode: "CYL-HD-002",
      name: "Cylinder Head 2-Valve",
      description: "Standard 2-valve cylinder head for economy vehicles",
      weightPerPiece: 1500,
      expectedScrap: 11,
    },
    {
      partCode: "PST-RNG-001",
      name: "Piston Assembly Standard",
      description: "Complete piston assembly with rings",
      weightPerPiece: 450,
      expectedScrap: 8,
    },
    {
      partCode: "PST-RNG-002",
      name: "Piston Assembly Heavy Duty",
      description: "Reinforced piston for commercial vehicles",
      weightPerPiece: 580,
      expectedScrap: 9,
    },
    {
      partCode: "VLV-CVR-001",
      name: "Valve Cover Standard",
      description: "Aluminum valve cover with gasket mount",
      weightPerPiece: 650,
      expectedScrap: 10,
    },
    {
      partCode: "INK-MNF-001",
      name: "Intake Manifold 4-Cyl",
      description: "Aluminum intake manifold for 4-cylinder engines",
      weightPerPiece: 1200,
      expectedScrap: 11,
    },
    {
      partCode: "INK-MNF-002",
      name: "Intake Manifold 6-Cyl",
      description: "Aluminum intake manifold for 6-cylinder engines",
      weightPerPiece: 1650,
      expectedScrap: 12,
    },
    {
      partCode: "OIL-PAN-001",
      name: "Oil Pan Standard",
      description: "Die-cast aluminum oil pan",
      weightPerPiece: 850,
      expectedScrap: 9,
    },
    {
      partCode: "TRB-HSG-001",
      name: "Turbo Housing",
      description: "High-temperature turbocharger housing",
      weightPerPiece: 720,
      expectedScrap: 14,
    },
    {
      partCode: "WTR-PMP-001",
      name: "Water Pump Housing",
      description: "Aluminum water pump housing",
      weightPerPiece: 380,
      expectedScrap: 7,
    },
  ];

  const parts = await Promise.all(
    partsData.map((p) =>
      prisma.part.create({
        data: { ...p, isActive: true },
      })
    )
  );
  console.log(`   ✓ Created ${parts.length} parts`);

  // =====================
  // INVENTORY
  // =====================
  console.log("\n📦 Initializing inventory...");

  // Every material line is one alloy grade in one form - scrap keeps the grade
  // of the heat it came off, so it is stocked per grade just as ingot is.
  const inventoryLevels: Record<AluminumType, number> = {
    INGOT_LM6: 120000,           // 120 kg
    INGOT_LM9: 40000,            // 40 kg
    INGOT_LM25: 25000,           // 25 kg
    RUNNER_RAISER_LM6: 32500,    // 32.5 kg
    RUNNER_RAISER_LM9: 9400,     // 9.4 kg
    RUNNER_RAISER_LM25: 5100,    // 5.1 kg
    SPILLAGE_LM6: 12800,         // 12.8 kg
    SPILLAGE_LM9: 3600,          // 3.6 kg
    SPILLAGE_LM25: 1900,         // 1.9 kg
    REJECTED_PART_LM6: 18500,    // 18.5 kg
    REJECTED_PART_LM9: 4700,     // 4.7 kg
    REJECTED_PART_LM25: 2300,    // 2.3 kg
  };

  for (const [type, quantity] of Object.entries(inventoryLevels)) {
    await prisma.inventory.create({
      data: {
        type: type as AluminumType,
        quantity,
      },
    });
  }
  console.log(`   ✓ Initialized inventory levels`);

  // =====================
  // PURCHASE ORDERS
  // =====================
  console.log("\n🛒 Creating purchase orders...");

  const purchaseOrdersData = [
    {
      poNumber: "PO-2024-0001",
      supplierId: suppliers[0].id,
      quantity: 75000,
      pricePerKg: 218,
      status: "DELIVERED" as const,
      expectedDate: daysAgo(5),
      deliveredDate: daysAgo(3),
      notes: "Regular monthly order - Quality verified",
      createdAt: daysAgo(12),
    },
    {
      poNumber: "PO-2024-0002",
      supplierId: suppliers[1].id,
      quantity: 50000,
      pricePerKg: 215,
      status: "DELIVERED" as const,
      expectedDate: daysAgo(8),
      deliveredDate: daysAgo(7),
      notes: "Urgent requirement for production",
      createdAt: daysAgo(15),
    },
    {
      poNumber: "PO-2024-0003",
      supplierId: suppliers[2].id,
      quantity: 60000,
      pricePerKg: 220,
      status: "IN_TRANSIT" as const,
      expectedDate: daysFromNow(2),
      deliveredDate: null,
      notes: "Premium grade aluminum",
      createdAt: daysAgo(5),
    },
    {
      poNumber: "PO-2024-0004",
      supplierId: suppliers[0].id,
      quantity: 45000,
      pricePerKg: 218,
      status: "CONFIRMED" as const,
      expectedDate: daysFromNow(5),
      deliveredDate: null,
      notes: "",
      createdAt: daysAgo(3),
    },
    {
      poNumber: "PO-2024-0005",
      supplierId: suppliers[3].id,
      quantity: 80000,
      pricePerKg: 212,
      status: "PENDING" as const,
      expectedDate: daysFromNow(8),
      deliveredDate: null,
      notes: "Bulk order - negotiate for better rate",
      createdAt: daysAgo(1),
    },
    {
      poNumber: "PO-2024-0006",
      supplierId: suppliers[4].id,
      quantity: 35000,
      pricePerKg: 225,
      status: "CANCELLED" as const,
      expectedDate: daysAgo(2),
      deliveredDate: null,
      notes: "Cancelled due to quality concerns",
      createdAt: daysAgo(10),
    },
    {
      poNumber: "PO-2024-0007",
      supplierId: suppliers[1].id,
      quantity: 55000,
      pricePerKg: 216,
      status: "DELIVERED" as const,
      expectedDate: daysAgo(15),
      deliveredDate: daysAgo(14),
      notes: "Standard delivery",
      createdAt: daysAgo(22),
    },
    {
      poNumber: "PO-2024-0008",
      supplierId: suppliers[2].id,
      quantity: 40000,
      pricePerKg: 219,
      status: "IN_TRANSIT" as const,
      expectedDate: daysFromNow(1),
      deliveredDate: null,
      notes: "Express shipping requested",
      createdAt: daysAgo(4),
    },
  ];

  const purchaseOrders = await Promise.all(
    purchaseOrdersData.map((po) =>
      prisma.purchaseOrder.create({
        data: {
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          quantity: po.quantity,
          pricePerKg: po.pricePerKg,
          totalAmount: (po.quantity / 1000) * po.pricePerKg,
          status: po.status,
          expectedDate: po.expectedDate,
          deliveredDate: po.deliveredDate,
          notes: po.notes,
          createdBy: admin.id,
          createdAt: po.createdAt,
        },
      })
    )
  );
  console.log(`   ✓ Created ${purchaseOrders.length} purchase orders`);

  // =====================
  // PRODUCTION RECORDS
  // =====================
  console.log("\n�icing Production records...");

  const productionRecordsData = [
    // Today's production
    {
      partId: parts[0].id, // Engine Block Type A
      aluminumUsed: 28000,
      quantityProduced: 10,
      goodParts: 9,
      rejectedParts: 1,
      runnerRaiserScrap: 2800,
      spillageScrap: 450,
      rejectedPartScrap: 2500,
      date: new Date(),
    },
    {
      partId: parts[2].id, // Cylinder Head 4-Valve
      aluminumUsed: 22000,
      quantityProduced: 12,
      goodParts: 11,
      rejectedParts: 1,
      runnerRaiserScrap: 1950,
      spillageScrap: 320,
      rejectedPartScrap: 1800,
      date: new Date(),
    },
    {
      partId: parts[4].id, // Piston Assembly Standard
      aluminumUsed: 15000,
      quantityProduced: 30,
      goodParts: 28,
      rejectedParts: 2,
      runnerRaiserScrap: 1100,
      spillageScrap: 180,
      rejectedPartScrap: 900,
      date: new Date(),
    },
    // Yesterday's production
    {
      partId: parts[1].id, // Engine Block Type B
      aluminumUsed: 35000,
      quantityProduced: 10,
      goodParts: 9,
      rejectedParts: 1,
      runnerRaiserScrap: 3500,
      spillageScrap: 580,
      rejectedPartScrap: 3200,
      date: daysAgo(1),
    },
    {
      partId: parts[6].id, // Valve Cover Standard
      aluminumUsed: 14000,
      quantityProduced: 20,
      goodParts: 19,
      rejectedParts: 1,
      runnerRaiserScrap: 1250,
      spillageScrap: 200,
      rejectedPartScrap: 650,
      date: daysAgo(1),
    },
    {
      partId: parts[7].id, // Intake Manifold 4-Cyl
      aluminumUsed: 18000,
      quantityProduced: 14,
      goodParts: 13,
      rejectedParts: 1,
      runnerRaiserScrap: 1800,
      spillageScrap: 290,
      rejectedPartScrap: 1200,
      date: daysAgo(1),
    },
    // 2 days ago
    {
      partId: parts[0].id,
      aluminumUsed: 30000,
      quantityProduced: 11,
      goodParts: 10,
      rejectedParts: 1,
      runnerRaiserScrap: 3100,
      spillageScrap: 480,
      rejectedPartScrap: 2500,
      date: daysAgo(2),
    },
    {
      partId: parts[9].id, // Oil Pan Standard
      aluminumUsed: 19000,
      quantityProduced: 21,
      goodParts: 20,
      rejectedParts: 1,
      runnerRaiserScrap: 1650,
      spillageScrap: 260,
      rejectedPartScrap: 850,
      date: daysAgo(2),
    },
    // 3 days ago
    {
      partId: parts[3].id, // Cylinder Head 2-Valve
      aluminumUsed: 17500,
      quantityProduced: 11,
      goodParts: 10,
      rejectedParts: 1,
      runnerRaiserScrap: 1650,
      spillageScrap: 280,
      rejectedPartScrap: 1500,
      date: daysAgo(3),
    },
    {
      partId: parts[10].id, // Turbo Housing
      aluminumUsed: 9500,
      quantityProduced: 12,
      goodParts: 11,
      rejectedParts: 1,
      runnerRaiserScrap: 1050,
      spillageScrap: 180,
      rejectedPartScrap: 720,
      date: daysAgo(3),
    },
    // 4 days ago
    {
      partId: parts[5].id, // Piston Assembly Heavy Duty
      aluminumUsed: 16000,
      quantityProduced: 25,
      goodParts: 24,
      rejectedParts: 1,
      runnerRaiserScrap: 1280,
      spillageScrap: 210,
      rejectedPartScrap: 580,
      date: daysAgo(4),
    },
    {
      partId: parts[8].id, // Intake Manifold 6-Cyl
      aluminumUsed: 20000,
      quantityProduced: 11,
      goodParts: 10,
      rejectedParts: 1,
      runnerRaiserScrap: 2050,
      spillageScrap: 340,
      rejectedPartScrap: 1650,
      date: daysAgo(4),
    },
    // 5 days ago
    {
      partId: parts[11].id, // Water Pump Housing
      aluminumUsed: 10000,
      quantityProduced: 25,
      goodParts: 24,
      rejectedParts: 1,
      runnerRaiserScrap: 680,
      spillageScrap: 120,
      rejectedPartScrap: 380,
      date: daysAgo(5),
    },
    {
      partId: parts[0].id,
      aluminumUsed: 27500,
      quantityProduced: 10,
      goodParts: 9,
      rejectedParts: 1,
      runnerRaiserScrap: 2950,
      spillageScrap: 420,
      rejectedPartScrap: 2500,
      date: daysAgo(5),
    },
    // 6 days ago
    {
      partId: parts[2].id,
      aluminumUsed: 24000,
      quantityProduced: 13,
      goodParts: 12,
      rejectedParts: 1,
      runnerRaiserScrap: 2150,
      spillageScrap: 350,
      rejectedPartScrap: 1800,
      date: daysAgo(6),
    },
    // 7 days ago
    {
      partId: parts[1].id,
      aluminumUsed: 38000,
      quantityProduced: 11,
      goodParts: 10,
      rejectedParts: 1,
      runnerRaiserScrap: 3900,
      spillageScrap: 620,
      rejectedPartScrap: 3200,
      date: daysAgo(7),
    },
  ];

  console.log("\n🔥 Creating furnaces...");
  const furnaces = [];
  for (const name of ["Furnace 1", "Furnace 2"]) {
    furnaces.push(
      await prisma.furnace.upsert({
        where: { name },
        update: {},
        create: { name },
      })
    );
  }
  console.log(`   ✓ Created ${furnaces.length} furnaces`);

  let batchCounter = 1;
  const productionRecords = [];

  for (const [index, record] of productionRecordsData.entries()) {
    // Every fourth batch casts two different parts, so the seeded data
    // exercises multi-part batches as well as single-part ones.
    const isMultiPart = index % 4 === 3;
    const secondPart = parts[(index + 5) % parts.length];

    const items =
      isMultiPart && secondPart.id !== record.partId
        ? [
            {
              partId: record.partId,
              quantityProduced: Math.ceil(record.quantityProduced / 2),
              goodParts: Math.ceil(record.goodParts / 2),
              rejectedParts:
                Math.ceil(record.quantityProduced / 2) - Math.ceil(record.goodParts / 2),
            },
            {
              partId: secondPart.id,
              quantityProduced: Math.floor(record.quantityProduced / 2),
              goodParts: Math.floor(record.goodParts / 2),
              rejectedParts:
                Math.floor(record.quantityProduced / 2) - Math.floor(record.goodParts / 2),
            },
          ]
        : [
            {
              partId: record.partId,
              quantityProduced: record.quantityProduced,
              goodParts: record.goodParts,
              rejectedParts: record.rejectedParts,
            },
          ];

    // Totals are always the sum of the lines
    const quantityProduced = items.reduce((sum, i) => sum + i.quantityProduced, 0);
    const goodParts = items.reduce((sum, i) => sum + i.goodParts, 0);
    const rejectedParts = items.reduce((sum, i) => sum + i.rejectedParts, 0);

    const totalScrap = record.runnerRaiserScrap + record.spillageScrap + record.rejectedPartScrap;
    const expectedOutput = items.reduce((sum, i) => {
      const part = parts.find((p) => p.id === i.partId)!;
      return sum + i.goodParts * part.weightPerPiece;
    }, 0);
    const efficiency = (expectedOutput / record.aluminumUsed) * 100;

    // rhoA is a typical Al-Si density; rhoB drops as gas content rises
    const densityAtmospheric = 2.65;
    const densityVacuum = Number((2.62 - (index % 5) * 0.03).toFixed(3));
    const densityIndex = Number(
      (((densityAtmospheric - densityVacuum) / densityAtmospheric) * 100).toFixed(2)
    );

    const batchNumber = `BATCH-${record.date.getFullYear()}${String(record.date.getMonth() + 1).padStart(2, "0")}${String(record.date.getDate()).padStart(2, "0")}-${String(batchCounter++).padStart(3, "0")}`;

    const prodRecord = await prisma.productionRecord.create({
      data: {
        batchNumber,
        furnaceId: furnaces[index % furnaces.length].id,
        items: { create: items },
        aluminumUsed: record.aluminumUsed,
        // Seeded batches are all LM6 heats, so the grade split matches the total
        aluminumUsedLM6: record.aluminumUsed,
        quantityProduced,
        goodParts,
        rejectedParts,
        runnerRaiserScrap: record.runnerRaiserScrap,
        spillageScrap: record.spillageScrap,
        rejectedPartScrap: record.rejectedPartScrap,
        totalScrap,
        efficiency,
        // Reduced Pressure Test figures, varied across batches so the
        // Density Index spans a realistic range
        densityAtmospheric,
        densityVacuum,
        densityIndex,
        // Sample free-form entries; keys are user-defined in the app
        composition: [
          { key: "Alloy", value: "LM6" },
          { key: "Si", value: `${(11.4 + (index % 4) * 0.3).toFixed(1)}%` },
          { key: "Fe", value: "0.42%" },
          { key: "Cu", value: "0.06%" },
        ],
        date: record.date,
        createdBy: plantHead.id,
        createdAt: record.date,
      },
    });
    productionRecords.push(prodRecord);
  }
  console.log(`   ✓ Created ${productionRecords.length} production records`);

  // =====================
  // INVENTORY LOGS
  // =====================
  console.log("\n📋 Creating inventory logs...");

  // Create logs for delivered POs
  const deliveredPOs = purchaseOrders.filter((po) => po.status === "DELIVERED");
  for (const po of deliveredPOs) {
    await prisma.inventoryLog.create({
      data: {
        type: po.ingotType,
        action: "ADD",
        quantity: po.quantity,
        previousQty: 0,
        newQty: po.quantity,
        reference: "PurchaseOrder",
        referenceId: po.id,
        notes: `Received from ${po.poNumber}`,
        createdBy: admin.id,
        createdAt: po.deliveredDate || po.createdAt,
      },
    });
  }

  // Create logs for production records
  for (const record of productionRecords) {
    // Ingot usage
    await prisma.inventoryLog.create({
      data: {
        type: "INGOT_LM6",
        action: "REMOVE",
        quantity: -record.aluminumUsed,
        previousQty: 0,
        newQty: 0,
        reference: "Production",
        referenceId: record.id,
        notes: `Used in ${record.batchNumber}`,
        createdBy: plantHead.id,
        createdAt: record.createdAt,
      },
    });

    // Scrap additions
    if (record.runnerRaiserScrap > 0) {
      await prisma.inventoryLog.create({
        data: {
          type: "RUNNER_RAISER_LM6",
          action: "ADD",
          quantity: record.runnerRaiserScrap,
          previousQty: 0,
          newQty: record.runnerRaiserScrap,
          reference: "Production",
          referenceId: record.id,
          notes: `From ${record.batchNumber}`,
          createdBy: plantHead.id,
          createdAt: record.createdAt,
        },
      });
    }

    if (record.spillageScrap > 0) {
      await prisma.inventoryLog.create({
        data: {
          type: "SPILLAGE_LM6",
          action: "ADD",
          quantity: record.spillageScrap,
          previousQty: 0,
          newQty: record.spillageScrap,
          reference: "Production",
          referenceId: record.id,
          notes: `From ${record.batchNumber}`,
          createdBy: plantHead.id,
          createdAt: record.createdAt,
        },
      });
    }

    if (record.rejectedPartScrap > 0) {
      await prisma.inventoryLog.create({
        data: {
          type: "REJECTED_PART_LM6",
          action: "ADD",
          quantity: record.rejectedPartScrap,
          previousQty: 0,
          newQty: record.rejectedPartScrap,
          reference: "Production",
          referenceId: record.id,
          notes: `From ${record.batchNumber}`,
          createdBy: plantHead.id,
          createdAt: record.createdAt,
        },
      });
    }
  }

  const logCount = await prisma.inventoryLog.count();
  console.log(`   ✓ Created ${logCount} inventory logs`);

  // =====================
  // FETTLING EMPLOYEES
  // =====================
  console.log("\n🛠  Creating fettling activity types...");
  const activityTypeNames = [
    "Riser Cutting",
    "Belt Sander",
    "Manual Filing",
    "Leak Testing",
    "Welding",
  ];
  const activityTypes = [];
  for (const [index, name] of activityTypeNames.entries()) {
    activityTypes.push(
      await prisma.activityType.upsert({
        where: { name },
        update: { sortOrder: index + 1, isActive: true },
        create: { name, sortOrder: index + 1 },
      })
    );
  }
  const activityByName = new Map(activityTypes.map((a) => [a.name, a]));
  console.log(`   ✓ Created ${activityTypes.length} activity types`);

  console.log("\n👷 Creating fettling employees...");

  const employeeSeed = [
    { employeeCode: "EMP-001", name: "Ramesh Jadhav", phone: "+91 98220 11001", activity: "Riser Cutting" },
    { employeeCode: "EMP-002", name: "Ganesh Pawar", phone: "+91 98220 11002", activity: "Riser Cutting" },
    { employeeCode: "EMP-003", name: "Suresh Kamble", phone: "+91 98220 11003", activity: "Belt Sander" },
    { employeeCode: "EMP-004", name: "Vijay More", phone: "+91 98220 11004", activity: "Belt Sander" },
    { employeeCode: "EMP-005", name: "Prakash Shinde", phone: "+91 98220 11005", activity: "Manual Filing" },
    { employeeCode: "EMP-006", name: "Sachin Bhosale", phone: "+91 98220 11006", activity: "Manual Filing" },
    { employeeCode: "EMP-007", name: "Nitin Salunke", phone: "+91 98220 11007", activity: "Leak Testing" },
    { employeeCode: "EMP-008", name: "Amol Gaikwad", phone: "+91 98220 11008", activity: "Welding" },
    { employeeCode: "EMP-009", name: "Dattatray Sawant", phone: "+91 98220 11009", activity: "Welding" },
    { employeeCode: "EMP-010", name: "Mahesh Chavan", phone: "+91 98220 11010", activity: "Leak Testing" },
  ];

  const employees = [];
  for (const emp of employeeSeed) {
    const { activity, ...rest } = emp;
    employees.push(
      await prisma.employee.create({
        data: {
          ...rest,
          activityTypeId: activityByName.get(activity)!.id,
          joinedAt: daysAgo(120 + employees.length * 15),
        },
        include: { activityType: true },
      })
    );
  }
  console.log(`   ✓ Created ${employees.length} employees`);

  // =====================
  // FETTLING ACTIVITY
  // =====================
  console.log("\n📝 Creating fettling activity records...");

  /** Date at UTC midnight, matching the DATE column used for activity days. */
  function workDay(daysBack: number): Date {
    const d = daysAgo(daysBack);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  // Rough daily throughput per operation, used to generate plausible numbers
  const outputRange: Record<string, [number, number]> = {
    "Riser Cutting": [90, 150],
    "Belt Sander": [70, 120],
    "Manual Filing": [50, 90],
    "Leak Testing": [110, 180],
    Welding: [30, 60],
  };

  let activityCount = 0;
  // Last 14 days, skipping Sundays
  for (let d = 0; d < 14; d++) {
    const date = workDay(d);
    if (date.getUTCDay() === 0) continue;

    for (const employee of employees) {
      const [min, max] = outputRange[employee.activityType.name];
      // Deterministic-ish spread so seeded numbers vary per employee and day
      const span = max - min;
      const offset = (d * 7 + employees.indexOf(employee) * 13) % (span + 1);
      const partsCompleted = min + offset;
      // A few percent fail inspection, varying by day, so the accepted and
      // rejected columns have something realistic in them
      const partsRejected = Math.floor((partsCompleted * ((d % 5) + 1)) / 100);

      // A shift covers more than one part, so most days get two lines. The
      // day's totals are the sum of them.
      const index = employees.indexOf(employee);
      const firstPart = parts[(d + index) % parts.length];
      const secondPart = parts[(d + index + 1) % parts.length];
      const splitAt = Math.max(1, Math.round(partsCompleted * 0.6));
      const lines =
        partsCompleted > 1 && firstPart.id !== secondPart.id
          ? [
              {
                partId: firstPart.id,
                partsCompleted: splitAt,
                partsRejected: Math.min(partsRejected, splitAt),
              },
              {
                partId: secondPart.id,
                partsCompleted: partsCompleted - splitAt,
                partsRejected: Math.max(0, partsRejected - splitAt),
              },
            ]
          : [{ partId: firstPart.id, partsCompleted, partsRejected }];

      await prisma.fettlingActivity.create({
        data: {
          employeeId: employee.id,
          activityTypeId: employee.activityTypeId,
          date,
          partsCompleted: lines.reduce((sum, l) => sum + l.partsCompleted, 0),
          partsRejected: lines.reduce((sum, l) => sum + l.partsRejected, 0),
          items: { create: lines },
          recordedBy: fettlingManager.id,
        },
      });
      activityCount++;
    }
  }
  console.log(`   ✓ Created ${activityCount} fettling activity records`);

  // =====================
  // SUMMARY
  // =====================
  console.log("\n" + "=".repeat(50));
  console.log("✅ DATABASE SEEDED SUCCESSFULLY!");
  console.log("=".repeat(50));
  console.log("\n📊 Summary:");
  console.log(`   • Users: 4`);
  console.log(`   • Suppliers: ${suppliers.length}`);
  console.log(`   • Companies: ${companies.length}`);
  console.log(`   • Parts: ${parts.length}`);
  console.log(`   • Furnaces: ${furnaces.length}`);
  console.log(`   • Purchase Orders: ${purchaseOrders.length}`);
  console.log(`   • Production Records: ${productionRecords.length}`);
  console.log(`   • Inventory Logs: ${logCount}`);
  console.log(`   • Activity Types: ${activityTypes.length}`);
  console.log(`   • Employees: ${employees.length}`);
  console.log(`   • Fettling Activities: ${activityCount}`);
  console.log("\n📝 Login Credentials:");
  console.log("   ┌─────────────────────────────────────────────┐");
  console.log("   │  Admin:                                     │");
  console.log("   │    Email: admin@moltenmetals.com            │");
  console.log("   │    Password: admin123                       │");
  console.log("   ├─────────────────────────────────────────────┤");
  console.log("   │  Production Manager:                        │");
  console.log("   │    Email: production@moltenmetals.com       │");
  console.log("   │    Password: production123                  │");
  console.log("   ├─────────────────────────────────────────────┤");
  console.log("   │  Fettling Manager:                          │");
  console.log("   │    Email: fettling@moltenmetals.com         │");
  console.log("   │    Password: fettling123                    │");
  console.log("   ├─────────────────────────────────────────────┤");
  console.log("   │  Accounts (read-only + settings):           │");
  console.log("   │    Email: accounts@moltenmetals.com         │");
  console.log("   │    Password: accounts123                    │");
  console.log("   └─────────────────────────────────────────────┘");
  console.log("");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
