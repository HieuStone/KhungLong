// Đo băng thông snapshot server gửi cho 1 client: node server/bench-net.mjs ws://localhost:8080 6  (chạy nhiều bản cùng lúc để thử tải)
import WebSocket from 'ws';
const url = process.argv[2] || 'ws://localhost:8099', secs = +(process.argv[3] || 6);
const ws = new WebSocket(url);
let bytes = 0, msgs = 0, maxMsg = 0, start = 0, sample = null;
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'bench', species: 'utahraptor' })));
ws.on('message', (d) => {
  const s = d.length; if (!start) start = Date.now();
  const m = JSON.parse(d); if (m.t !== 'snap') return;
  bytes += s; msgs++; maxMsg = Math.max(maxMsg, s);
  if (!sample) sample = m;
  setInterval(() => ws.send(JSON.stringify({ t: 'input', seq: 1, mx: 0, mz: -1, yaw: 0, sprint: false, up: 0 })), 50);
});
setTimeout(() => {
  const dt = (Date.now() - start) / 1000;
  console.log(JSON.stringify({ msgsPerSec: +(msgs / dt).toFixed(1), avgKB: +(bytes / msgs / 1024).toFixed(1), maxKB: +(maxMsg / 1024).toFixed(1), KBps: +(bytes / dt / 1024).toFixed(0),
    players: sample?.players.length, npcs: sample?.npcs.length, carcasses: sample?.carcasses.length, playerEntry: JSON.stringify(sample?.players[0]) }));
  process.exit(0);
}, secs * 1000);
