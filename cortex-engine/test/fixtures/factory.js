function createUserService(db) {
  function validate(user) {
    return user.name && user.email;
  }

  const formatName = (name) => name.trim().toLowerCase();

  async function save(user) {
    if (!validate(user)) throw new Error('invalid');
    return db.insert(user);
  }

  return {
    validate,
    formatName,
    save,
  };
}

module.exports = createUserService;
