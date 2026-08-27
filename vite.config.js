import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Durante o desenvolvimento local com "vercel dev" as chamadas a /api
    // são servidas automaticamente. Se usares apenas "npm run dev" (sem
    // vercel dev), as chamadas a /api/news vão falhar por não haver backend
    // — nesse caso usa "vercel dev" para testar a app por completo.
    port: 5173,
  },
});
