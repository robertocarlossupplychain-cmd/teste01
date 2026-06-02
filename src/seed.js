require("dotenv").config();
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

async function seed() {
  // Tentar usar IPv4 explicitamente se a URI padrão falhar
  const uri = process.env.MONGODB_URI;
  console.log("Conectando ao MongoDB...");

  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    family: 4, // Forçar IPv4
  });

  try {
    await client.connect();
    console.log("✅ Conectado ao MongoDB com sucesso!");
    const db = client.db();

    console.log("--- Iniciando Seed do Banco de Dados ---");

    // 1. Coleção de Usuários e Perfis
    const users = db.collection("users");
    await users.createIndex({ email: 1 }, { unique: true });

    const adminExists = await users.findOne({ role: "Admin" });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      await users.insertOne({
        name: "Administrador Master",
        email: "admin@buildflow.com.br",
        password: hashedPassword,
        role: "Admin",
        permissions: ["all"],
        createdAt: new Date(),
      });
      console.log(
        "✅ Usuário Admin criado (admin@buildflow.com.br / admin123)",
      );
    }

    // 2. Coleção de Produtos
    const products = db.collection("products");
    await products.createIndex({ sku: 1 }, { unique: true });
    await products.createIndex({ name: "text" });

    // 3. Coleção de Vendas
    const sales = db.collection("sales");
    await sales.createIndex({ createdAt: -1 });

    // 4. Coleção de Entradas
    const purchases = db.collection("purchases");
    await purchases.createIndex({ createdAt: -1 });

    // 5. Coleção de Logs/Auditoria
    const logs = db.collection("logs");
    await logs.createIndex({ timestamp: -1 });

    const stockMovements = db.collection("movimentacoes_estoque");
    await stockMovements.createIndex({ timestamp: -1 });
    await stockMovements.createIndex({ sku: 1 });

    // 6. Dados de Exemplo (Opcional - para o sistema não vir vazio)
    const productCount = await products.countDocuments();
    if (productCount === 0) {
      await products.insertMany([
        {
          name: "Cimento CP-II 50kg",
          sku: "MAT-001",
          barcode: "7891234567890",
          category: "Materiais",
          quantity: 120,
          minStock: 40,
          maxStock: 220,
          perishable: false,
          price: 35.9,
          costPrice: 25.0,
          supplier: "Votorantim",
          status: "Em estoque",
          unit: "UN",
          location: {
            aisle: "RECV",
            shelf: "00",
            level: "00",
            slot: "00",
            deposit: "DEPÓSITO 01",
          },
          createdAt: new Date(),
        },
        {
          name: "Tubo PVC 100mm 6m",
          sku: "HID-042",
          barcode: "7891234567891",
          category: "Hidráulica",
          quantity: 45,
          minStock: 20,
          maxStock: 90,
          perishable: false,
          price: 89.9,
          costPrice: 60.0,
          supplier: "Tigre",
          status: "Em estoque",
          unit: "UN",
          location: {
            aisle: "A",
            shelf: "01",
            level: "01",
            slot: "05",
            deposit: "DEPÓSITO 01",
          },
          createdAt: new Date(),
        },
        {
          name: "Fio Flexível 2.5mm",
          sku: "ELE-105",
          barcode: "7891234567892",
          category: "Elétrica",
          quantity: 12,
          minStock: 15,
          maxStock: 40,
          perishable: false,
          price: 185.0,
          costPrice: 130.0,
          supplier: "Sil",
          status: "Baixo estoque",
          unit: "UN",
          location: {
            aisle: "RECV",
            shelf: "00",
            level: "00",
            slot: "00",
            deposit: "DEPÓSITO 01",
          },
          createdAt: new Date(),
        },
        {
          name: "Tinta Acrílica 18L",
          sku: "TIN-018",
          barcode: "7891234567893",
          category: "Tintas",
          quantity: 28,
          minStock: 10,
          maxStock: 60,
          perishable: true,
          expiryDate: new Date(Date.now() + 16 * 24 * 60 * 60 * 1000),
          price: 220.0,
          costPrice: 150.0,
          supplier: "Suvinil",
          status: "Em estoque",
          unit: "UN",
          location: {
            aisle: "T",
            shelf: "02",
            level: "01",
            slot: "07",
            deposit: "DEPÓSITO 01",
          },
          createdAt: new Date(),
        },
      ]);
      console.log("✅ Produtos iniciais inseridos");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = await sales.countDocuments({
      createdAt: { $gte: today },
    });
    if (todaySales === 0) {
      const now = new Date();
      await sales.insertMany([
        {
          total: 71.8,
          status: "FINALIZED",
          paymentMethod: "PIX",
          amountPaid: 71.8,
          change: 0,
          createdAt: now,
          items: [
            {
              name: "Cimento CP-II 50kg",
              qty: 2,
              price: 35.9,
              costPrice: 25.0,
            },
          ],
        },
        {
          total: 89.9,
          status: "FINALIZED",
          paymentMethod: "Cartão de Débito",
          amountPaid: 89.9,
          change: 0,
          createdAt: now,
          items: [
            { name: "Tubo PVC 100mm 6m", qty: 1, price: 89.9, costPrice: 60.0 },
          ],
        },
      ]);
      console.log("✅ Vendas de exemplo (hoje) inseridas");
    }

    const lowStock = await products.countDocuments({
      $or: [{ status: { $regex: /baixo/i } }, { quantity: { $lt: 20 } }],
    });
    if (lowStock === 0 && productCount > 0) {
      const first = await products.findOne({});
      if (first) {
        await products.updateOne(
          { _id: first._id },
          { $set: { quantity: 8, status: "Baixo estoque" } },
        );
        console.log("✅ Produto de exemplo marcado como baixo estoque");
      }
    }

    const warehouseAddresses = db.collection("warehouse_addresses");
    await warehouseAddresses.createIndex({ code: 1 }, { unique: true });
    const addrCount = await warehouseAddresses.countDocuments();
    if (addrCount === 0) {
      await warehouseAddresses.insertMany([
        {
          aisle: "RECV",
          shelf: "00",
          level: "00",
          slot: "00",
          code: "RECV-00-00-00",
          zone: "Recebimento",
          deposit: "DEPÓSITO 01",
          description: "Área de Recebimento (Padrão)",
          active: true,
          isReceiving: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          aisle: "A",
          shelf: "01",
          level: "01",
          slot: "05",
          code: "A-01-01-05",
          zone: "Materiais",
          deposit: "DEPÓSITO 01",
          description: "Entrada principal",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          aisle: "A",
          shelf: "02",
          level: "02",
          slot: "10",
          code: "A-02-02-10",
          zone: "Hidráulica",
          deposit: "DEPÓSITO 01",
          description: "Corredor A",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          aisle: "B",
          shelf: "01",
          level: "03",
          slot: "02",
          code: "B-01-03-02",
          zone: "Elétrica",
          deposit: "DEPÓSITO 01",
          description: "Fundos",
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      console.log("✅ Endereços de armazém iniciais inseridos");
    }

    // 7. Configurações da Empresa
    const settings = db.collection("settings");
    const settingsExist = await settings.findOne({});
    if (!settingsExist) {
      await settings.insertOne({
        companyName: "BuildFlow ERP & Logística S.A.",
        cnpj: "12.345.678/0001-90",
        address: "Av. Principal, 1000 - São Paulo/SP",
        theme: "dark",
        notifications: true,
      });
      console.log("✅ Configurações iniciais criadas");
    }

    console.log("--- Seed finalizado com sucesso ---");
  } catch (error) {
    console.error("❌ Erro no seed:", error);
  } finally {
    await client.close();
  }
}

seed();
