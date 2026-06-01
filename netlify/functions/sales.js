const { getDb } = require('../../src/lib/mongodb');
const { verifyToken } = require('../../src/lib/auth');
const { ObjectId } = require('mongodb');

exports.handler = async (event, context) => {
  const user = verifyToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ message: 'Não autorizado' }) };
  }

  const db = await getDb();
  const sales = db.collection('sales');

  try {
    switch (event.httpMethod) {
      case 'GET':
        const { start, end, status: filterStatus } = event.queryStringParameters || {};
        let query = {};
        
        if (start && end) {
          query.createdAt = {
            $gte: new Date(start),
            $lte: new Date(end)
          };
        }

        if (filterStatus) {
          query.status = filterStatus;
        }

        const data = await sales.find(query).sort({ createdAt: -1 }).toArray();
        return { statusCode: 200, body: JSON.stringify(data) };

      case 'PUT':
        const { id } = event.queryStringParameters || {};
        if (!id) return { statusCode: 400, body: 'ID da venda é obrigatório' };

        const updateData = JSON.parse(event.body);
        const oldSale = await sales.findOne({ _id: new ObjectId(id) });
        if (!oldSale) return { statusCode: 404, body: 'Venda não encontrada' };

        // Se o status mudou para FINALIZED (de RESERVED)
        if (updateData.status === 'FINALIZED' && oldSale.status === 'RESERVED') {
          for (const item of oldSale.items) {
            await db.collection('products').updateOne(
              { _id: new ObjectId(item.id) },
              { 
                $inc: { 
                  reserved: -item.qty,
                  quantity: -item.qty
                } 
              }
            );
          }
        } 
        // Se o status mudou para CANCELLED
        else if (updateData.status === 'CANCELLED' && oldSale.status !== 'CANCELLED') {
          for (const item of oldSale.items) {
            if (oldSale.status === 'RESERVED') {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { reserved: -item.qty } }
              );
            } else if (oldSale.status === 'FINALIZED') {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { quantity: item.qty } }
              );
            }
          }
        }
        // Se houver edição de itens (simplificado: remove estoque antigo e aplica novo)
        else if (updateData.items && oldSale.status !== 'CANCELLED') {
          // Reverter estoque antigo
          for (const item of oldSale.items) {
            if (oldSale.status === 'RESERVED') {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { reserved: -item.qty } }
              );
            } else {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { quantity: item.qty } }
              );
            }
          }
          // Aplicar estoque novo
          for (const item of updateData.items) {
            if (updateData.status === 'RESERVED' || (!updateData.status && oldSale.status === 'RESERVED')) {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { reserved: item.qty } }
              );
            } else {
              await db.collection('products').updateOne(
                { _id: new ObjectId(item.id) },
                { $inc: { quantity: -item.qty } }
              );
            }
          }
        }

        await sales.updateOne(
          { _id: new ObjectId(id) },
          { $set: { ...updateData, updatedAt: new Date() } }
        );

        // Log de auditoria
        await db.collection('logs').insertOne({
          userId: user.userId,
          action: 'UPDATE_SALE',
          entity: 'sales',
          entityId: new ObjectId(id),
          timestamp: new Date(),
          details: `Venda ${id} atualizada. Novo status: ${updateData.status || oldSale.status}`
        });

        return { statusCode: 200, body: JSON.stringify({ message: 'Venda atualizada com sucesso' }) };

      case 'POST': {
        const body = JSON.parse(event.body);
        const {
          items,
          total,
          globalDiscount,
          globalDiscountType,
          status,
          paymentMethod,
          subtotal,
          grossSubtotal,
          itemsDiscountTotal,
          globalDiscountAmount,
          totalDiscount,
          amountPaid,
          change: changeAmount
        } = body;
        const saleStatus = status || 'FINALIZED';

        if (!items || !items.length) {
          return { statusCode: 400, body: JSON.stringify({ message: 'A venda precisa ter ao menos um item.' }) };
        }

        const productsCol = db.collection('products');
        const demand = new Map();
        for (const item of items) {
          if (!item.id) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Item sem identificador de produto.' }) };
          }
          const qty = Math.max(0, Number(item.qty) || 0);
          if (qty < 1) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Quantidade inválida em um dos itens.' }) };
          }
          const id = String(item.id);
          demand.set(id, (demand.get(id) || 0) + qty);
        }

        const stockErrors = [];
        for (const [productId, wantQty] of demand) {
          let prod;
          try {
            prod = await productsCol.findOne({ _id: new ObjectId(productId) });
          } catch {
            prod = null;
          }
          if (!prod) {
            stockErrors.push({ productId, message: 'Produto não encontrado.' });
            continue;
          }
          const physical = Math.max(0, prod.quantity || 0);
          const reserved = Math.max(0, prod.reserved || 0);
          const available = Math.max(0, physical - reserved);
          if (wantQty > available) {
            stockErrors.push({
              productName: prod.name,
              requested: wantQty,
              available,
              reserved,
              physical,
              message: `${prod.name}: solicitado ${wantQty}, disponível ${available} (${reserved} reservado(s)).`
            });
          }
        }

        if (stockErrors.length > 0) {
          return {
            statusCode: 400,
            body: JSON.stringify({
              message: 'Estoque insuficiente. Não é possível vender ou reservar acima do disponível.',
              errors: stockErrors
            })
          };
        }

        const numericId = parseInt(`${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`);

        const sale = {
          saleNumber: numericId,
          items,
          total: Number(total) || 0,
          subtotal: grossSubtotal != null ? Number(grossSubtotal) : (subtotal != null ? Number(subtotal) : undefined),
          grossSubtotal: grossSubtotal != null ? Number(grossSubtotal) : undefined,
          itemsDiscountTotal: itemsDiscountTotal != null ? Number(itemsDiscountTotal) : 0,
          globalDiscount: globalDiscount || 0,
          globalDiscountType: globalDiscountType || 'percent',
          globalDiscountAmount: globalDiscountAmount != null ? Number(globalDiscountAmount) : 0,
          totalDiscount: totalDiscount != null ? Number(totalDiscount) : 0,
          status: saleStatus,
          paymentMethod: paymentMethod || 'Dinheiro',
          amountPaid: amountPaid != null ? Number(amountPaid) : null,
          change: changeAmount != null ? Number(changeAmount) : null,
          userId: user.userId,
          createdAt: new Date()
        };

        const result = await sales.insertOne(sale);
        const appliedStock = [];

        for (const [productId, wantQty] of demand) {
          const filter = {
            _id: new ObjectId(productId),
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ['$quantity', 0] },
                    { $ifNull: ['$reserved', 0] }
                  ]
                },
                wantQty
              ]
            }
          };
          const update = saleStatus === 'RESERVED'
            ? { $inc: { reserved: wantQty } }
            : { $inc: { quantity: -wantQty } };

          const stockUpdate = await productsCol.updateOne(filter, update);
          if (stockUpdate.modifiedCount === 0) {
            await sales.deleteOne({ _id: result.insertedId });
            for (const applied of appliedStock) {
              const rollback = saleStatus === 'RESERVED'
                ? { $inc: { reserved: -applied.qty } }
                : { $inc: { quantity: applied.qty } };
              await productsCol.updateOne({ _id: new ObjectId(applied.productId) }, rollback);
            }
            return {
              statusCode: 409,
              body: JSON.stringify({
                message: 'Conflito de estoque. Outra operação alterou o saldo. Tente novamente.'
              })
            };
          }
          appliedStock.push({ productId, qty: wantQty });
        }

        // 3. Log de auditoria
        await db.collection('logs').insertOne({
          userId: user.userId,
          action: 'CREATE_SALE',
          entity: 'sales',
          entityId: result.insertedId,
          timestamp: new Date(),
          details: `Venda ${result.insertedId} realizada no valor de R$ ${sale.total}`
        });

        return {
          statusCode: 201,
          body: JSON.stringify({
            message: 'Venda realizada com sucesso',
            saleId: result.insertedId,
            id: result.insertedId,
            _id: result.insertedId,
            saleNumber: sale.saleNumber,
            sale
          })
        };
      }

      default:
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
  } catch (error) {
    console.error('Sales function error:', error);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ 
        message: 'Erro ao processar venda',
        error: error.message
      }) 
    };
  }
};
