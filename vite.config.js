import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 공공 API 는 브라우저에서 바로 부를 수 없어서(CORS) /api/* 로 부르고 원래 주소로 넘긴다.
// 배포(Render 정적 사이트)는 render.yaml 의 rewrite 가 같은 일을 한다. 둘을 같이 고칠 것.
const relay = (target, prefix) => ({
  target,
  changeOrigin: true,
  rewrite: (p) => p.replace(prefix, ''),
});
const proxy = {
  '/api/gbis': relay('https://apis.data.go.kr/6410000', /^\/api\/gbis/),
  '/api/rtms': relay('https://apis.data.go.kr/1613000', /^\/api\/rtms/),
  '/api/opinet': relay('https://www.opinet.co.kr/api', /^\/api\/opinet/),
  '/api/subway': relay('http://swopenapi.seoul.go.kr/api/subway', /^\/api\/subway/),
  '/api/kma': relay('https://apis.data.go.kr/1360000', /^\/api\/kma/),
  '/api/airkorea': relay('https://apis.data.go.kr/B552584', /^\/api\/airkorea/),
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
});
