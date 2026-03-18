const { pool } = require('../db');
const express = require('express');

function handler(req, res) {
  res.json({ ok: true });
}

module.exports = { handler };
