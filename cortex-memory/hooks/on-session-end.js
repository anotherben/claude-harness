#!/usr/bin/env node

// SessionEnd hook for cortex-memory
// Currently a no-op — indexing deferred to CLI: `cortex-memory index --since 1d`
// MUST exit 0 always — never block session close

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);
    if (data.session_id) {
      console.error(`[cortex-memory] Session ${data.session_id} ended. Run 'cortex-memory index --since 1d' to index.`);
    }
  } catch (err) {
    console.error(`[cortex-memory] Hook error: ${err.message}`);
  }
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data || '{}'), 5000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

main();
