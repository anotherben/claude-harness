const express = require('express');

function authenticateStaff(req, res, next) {
  next();
}

function createOrderRoutes(db) {
  const router = express.Router();

  router.get('/orders', async (req, res) => {
    const orders = await db.query('SELECT * FROM orders');
    res.json(orders);
  });

  router.post('/orders', authenticateStaff, async (req, res) => {
    const order = await db.query('INSERT INTO orders ...');
    res.status(201).json(order);
  });

  router.get('/orders/:id', async (req, res) => {
    const order = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    res.json(order);
  });

  router.put('/orders/:id', authenticateStaff, async (req, res) => {
    const order = await db.query('UPDATE orders SET ...');
    res.json(order);
  });

  router.delete('/orders/:id', authenticateStaff, async (req, res) => {
    await db.query('DELETE FROM orders WHERE id = $1', [req.params.id]);
    res.status(204).send();
  });

  router.patch('/orders/:id/approve', authenticateStaff, async (req, res) => {
    const order = await db.query('UPDATE orders SET status = $1', ['approved']);
    res.json(order);
  });

  // Non-route calls should NOT be extracted
  console.log('Routes registered');
  db.connect();

  return router;
}

module.exports = createOrderRoutes;
