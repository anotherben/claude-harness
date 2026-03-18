const createLogger = (prefix) => {
  const format = (msg) => `[${prefix}] ${msg}`;

  function timestamp() {
    return new Date().toISOString();
  }

  const log = (msg) => console.log(format(`${timestamp()}: ${msg}`));

  return { log, format, timestamp };
};

module.exports = createLogger;
