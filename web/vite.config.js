import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages(/drmarket/) 등 하위 경로에서도 동작하도록 상대 경로로 빌드
  base: './',
  server: { port: Number(process.env.PORT) || 5173, strictPort: !!process.env.PORT },
})
