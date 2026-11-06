import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 3000 matches Supabase's default auth redirect URL,
// so email confirmation links land back here.
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
});
