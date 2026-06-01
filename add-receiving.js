require("dotenv").config();
const { MongoClient } = require("mongodb");

async function addReceiving() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();
    const addresses = db.collection("warehouse_addresses");

    // Check if Receiving address exists
    const existing = await addresses.findOne({ code: "RECV-00-00-00" });

    if (!existing) {
      await addresses.insertOne({
        aisle: "RECV",
        shelf: "00",
        level: "00",
        slot: "00",
        code: "RECV-00-00-00",
        zone: "Recebimento",
        description: "Área de Recebimento (Padrão)",
        active: true,
        isReceiving: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log("✅ Receiving address created: RECV-00-00-00");
    } else {
      console.log("✅ Receiving address already exists");
    }

    // List all warehouse addresses
    const all = await addresses.find({}).toArray();
    console.log("\nWarehouse Addresses:");
    all.forEach((a) => console.log(`  - ${a.code} (${a.zone})`));
  } finally {
    await client.close();
  }
}

addReceiving().catch(console.error);
