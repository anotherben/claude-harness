class OrderProcessor {
  constructor(db) {
    this.db = db;
  }

  process(order) {
    function calculateTax(amount) {
      return amount * 0.1;
    }

    const applyDiscount = (amount, pct) => amount * (1 - pct);

    const total = applyDiscount(order.amount, order.discount);
    return total + calculateTax(total);
  }

  async save(order) {
    function serialize(obj) {
      return JSON.stringify(obj);
    }
    return this.db.insert(serialize(order));
  }
}

module.exports = OrderProcessor;
