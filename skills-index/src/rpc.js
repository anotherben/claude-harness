/**
 * Line-delimited JSON-RPC 2.0 transport over any Duplex stream pair.
 * Used by the skills-index daemon and proxy to communicate over a Unix socket.
 */
export class RpcConnection {
  constructor(readable, writable) {
    this._readable = readable;
    this._writable = writable;
    this._buf = '';
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject }
    this._handlers = new Map(); // method -> async fn
    this._closed = false;

    this._onClose = () => this.close();
    this._onError = (err) => this.close(err instanceof Error ? err : new Error('rpc connection closed'));
    this._onData = (chunk) => {
      this._buf += chunk.toString('utf8');
      let nl;
      while ((nl = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, nl);
        this._buf = this._buf.slice(nl + 1);
        if (line.trim()) this._handleFrame(line);
      }
    };
    this._readable.on('data', this._onData);
    this._readable.on('close', this._onClose);
    this._readable.on('end', this._onClose);
    this._readable.on('error', this._onError);
    if (this._writable !== this._readable) {
      this._writable.on('close', this._onClose);
      this._writable.on('error', this._onError);
    }
  }

  onRequest(method, handler) {
    this._handlers.set(method, handler);
  }

  request(method, params) {
    if (this._closed) return Promise.reject(new Error('rpc connection closed'));
    const id = this._nextId++;
    const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try {
        this._writable.write(frame, (err) => {
          if (err) {
            this.close(err instanceof Error ? err : new Error('rpc write failed'));
          }
        });
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  async _handleFrame(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.id != null && msg.method) {
      // Incoming request
      const handler = this._handlers.get(msg.method);
      if (!handler) {
        this._send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32601, message: 'method not found' },
        });
        return;
      }
      try {
        const result = await handler(msg.params);
        this._send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (err) {
        this._send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: err.code ?? -32000, message: err.message ?? 'internal error' },
        });
      }
    } else if (msg.id != null) {
      // Response to a pending request
      const pending = this._pending.get(msg.id);
      if (!pending) return;
      this._pending.delete(msg.id);
      if (msg.error) pending.reject(msg.error);
      else pending.resolve(msg.result);
    }
  }

  _send(obj) {
    this._writable.write(JSON.stringify(obj) + '\n');
  }

  close(reason = new Error('rpc connection closed')) {
    if (this._closed) return;
    this._closed = true;
    this._readable.removeListener('data', this._onData);
    this._readable.removeListener('close', this._onClose);
    this._readable.removeListener('end', this._onClose);
    this._readable.removeListener('error', this._onError);
    if (this._writable !== this._readable) {
      this._writable.removeListener('close', this._onClose);
      this._writable.removeListener('error', this._onError);
    }
    for (const { reject } of this._pending.values()) {
      reject(reason);
    }
    this._pending.clear();
  }
}
