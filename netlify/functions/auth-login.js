const { getDb } = require('../../src/lib/mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
  console.log(`[${new Date().toISOString()}] auth-login function started: ${event.httpMethod}`);
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    if (!event.body) {
      console.error('Missing event body');
      return { statusCode: 400, body: JSON.stringify({ message: 'Corpo da requisição ausente' }) };
    }

    const { email, password } = JSON.parse(event.body);
    console.log(`Attempting login for: ${email}`);

    const db = await getDb();
    console.log('Database connection obtained');
    const users = db.collection('users');

    const user = await users.findOne({ email });

    if (!user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Credenciais inválidas' })
      };
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Credenciais inválidas' })
      };
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Log de auditoria
    await db.collection('logs').insertOne({
      userId: user._id,
      action: 'LOGIN',
      entity: 'users',
      timestamp: new Date(),
      details: `Login bem sucedido para ${user.email}`
    });

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`
      },
      body: JSON.stringify({
        message: 'Login realizado com sucesso',
        token,
        user: {
          name: user.name,
          email: user.email,
          role: user.role
        }
      })
    };
  } catch (error) {
    console.error('Login function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Erro interno no servidor',
        error: error.message
      })
    };
  }
};
