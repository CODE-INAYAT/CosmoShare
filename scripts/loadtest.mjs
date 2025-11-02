import WebSocket from "ws";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.findIndex((a) => a === name || a.startsWith(name + "="));
    if (i === -1) return def;
    const v = args[i].includes("=")
      ? args[i].split("=").slice(1).join("=")
      : args[i + 1];
    return v ?? def;
  };
  // Also support positional args: url room total batch interval
  const positionals = args.filter((a) => !a.startsWith("--"));
  const url = get("--url", positionals[0] || process.env.SIGNALING_WSS || "");
  const room = get("--room", positionals[1] || "301");
  const total = parseInt(get("--total", positionals[2] || "1000"), 10);
  const batch = parseInt(get("--batch", positionals[3] || "200"), 10);
  const intervalMs = parseInt(get("--interval", positionals[4] || "200"), 10);
  const timeoutMs = parseInt(get("--timeout", "15000"), 10);
  return { url, room, total, batch, intervalMs, timeoutMs };
}

function toWsUrl(base) {
  if (!base) return "";
  if (base.startsWith("wss://") || base.startsWith("ws://")) return base;
  if (base.startsWith("https://"))
    return "wss://" + base.slice("https://".length);
  if (base.startsWith("http://")) return "ws://" + base.slice("http://".length);
  return base;
}

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cfg = parseArgs();
  if (!cfg.url) {
    console.error(
      "Missing --url or SIGNALING_WSS. Example: --url wss://your-worker.workers.dev"
    );
    process.exit(1);
  }

  const base = toWsUrl(cfg.url).replace(/\/$/, "");
  const target = `${base}/ws?room=${encodeURIComponent(cfg.room)}`;

  console.log("Load test starting with config:");
  console.log({
    target,
    room: cfg.room,
    total: cfg.total,
    batch: cfg.batch,
    intervalMs: cfg.intervalMs,
  });

  const sockets = new Array(cfg.total);
  let opened = 0,
    failed = 0,
    closed = 0;
  let messages = 0;

  const statsTimer = setInterval(() => {
    console.log(
      `[STATS] opened=${opened} failed=${failed} closed=${closed} inflight=${
        opened - closed
      } messages=${messages}`
    );
  }, 2000);

  const connectOne = (i) =>
    new Promise((resolve) => {
      const ws = new WebSocket(target, { perMessageDeflate: false });
      let done = false;

      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };

      ws.on("open", () => {
        opened++;
        // Send join-room event
        const user = {
          id: `u-${i}`,
          name: `User ${i}`,
          uniqueId: `U${i}`,
          roomNumber: cfg.room,
          isOnline: true,
        };
        const payload = {
          event: "join-room",
          data: { roomNumber: cfg.room, user },
        };
        try {
          ws.send(JSON.stringify(payload));
        } catch {}
        finish();
      });
      ws.on("message", () => {
        messages++;
      });
      ws.on("error", () => {
        failed++;
        finish();
      });
      ws.on("close", () => {
        closed++;
      });

      sockets[i] = ws;

      // Safety: mark as failed if not opened within timeout
      setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          failed++;
          try {
            ws.close();
          } catch {}
          finish();
        }
      }, cfg.timeoutMs);
    });

  for (let i = 0; i < cfg.total; i += cfg.batch) {
    const end = Math.min(cfg.total, i + cfg.batch);
    const tasks = [];
    for (let j = i; j < end; j++) tasks.push(connectOne(j));
    await Promise.all(tasks);
    await delay(cfg.intervalMs);
  }

  console.log("Ramp complete. Holding connections for 20s...");
  await delay(20000);

  console.log("Closing all sockets...");
  for (const ws of sockets) {
    try {
      ws?.close();
    } catch {}
  }
  await delay(2000);

  clearInterval(statsTimer);
  console.log("Done.");
  console.log(
    `[FINAL] opened=${opened} failed=${failed} closed=${closed} messages=${messages}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
