import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 다른 터미널에서 `npm run server`(포트 8787)를 켜 두면 /api 를 그쪽으로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8787' } }
});
