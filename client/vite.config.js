import { defineConfig } from 'vite';
import os from 'node:os';

const PORT = 5173;
const GAME_PORT = +(process.env.ISLE_PORT || 8080);

/** Địa chỉ IPv4 trong mạng LAN của máy này (Wi-Fi, Ethernet...). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

/** Khi dev server chạy: in rõ các địa chỉ để máy khác vào chơi (LAN và Internet). */
function shareAddresses() {
  return {
    name: 'isle-share-addresses',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        const port = server.config.server.port || PORT;
        const lines = ['', '  ===== Isle Lite: máy khác vào chơi bằng các địa chỉ sau =====',
          `  Máy này:        http://localhost:${port}/`];
        for (const ip of lanAddresses()) lines.push(`  Cùng mạng LAN:  http://${ip}:${port}/   (điện thoại/máy khác dùng chung Wi-Fi)`);
        // IP công cộng: hỏi một dịch vụ trả về IP (chỉ gửi yêu cầu, không gửi dữ liệu gì). Tắt bằng ISLE_NO_PUBLIC_IP=1
        if (!process.env.ISLE_NO_PUBLIC_IP) {
          try {
            const ctl = AbortSignal.timeout(3000);
            const ip = (await (await fetch('https://api.ipify.org', { signal: ctl })).text()).trim();
            if (/^[\d.]+$/.test(ip)) {
              lines.push(`  Qua Internet:   http://${ip}:${port}/`);
              lines.push(`                  -> cần mở cổng (port forward) ${port}/TCP trên router về máy này; hoặc dùng tunnel,`);
              lines.push(`                     vd: npx cloudflared tunnel --url http://localhost:${port}`);
            }
          } catch { /* không có mạng / bị chặn: bỏ qua */ }
        }
        lines.push('  Lần đầu chạy, Windows có thể hỏi cho phép Node.js qua tường lửa: chọn Allow (cả mạng Private).');
        lines.push('  ===============================================================', '');
        console.log(lines.join('\n'));
      });
    },
  };
}

export default defineConfig({
  plugins: [shareAddresses()],
  server: {
    port: PORT,
    host: true,            // lắng nghe mọi địa chỉ mạng (không chỉ localhost) để máy khác truy cập được
    allowedHosts: true,    // chấp nhận tên miền của tunnel (cloudflared/ngrok...)
    // WebSocket của game đi qua cùng cổng web: máy khác chỉ cần mở 1 cổng, dùng được cả qua HTTPS/tunnel
    proxy: { '/ws': { target: `ws://localhost:${GAME_PORT}`, ws: true } },
  },
  preview: { port: PORT, host: true, proxy: { '/ws': { target: `ws://localhost:${GAME_PORT}`, ws: true } } },
});
