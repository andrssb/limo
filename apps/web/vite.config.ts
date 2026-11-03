import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Connect } from "vite";

function autoLoginMiddleware(): { name: string; configureServer: (s: any) => void } {
  return {
    name: "auto-login",
    configureServer(server) {
      server.middlewares.use((req: Connect.IncomingMessage, res: any, next: () => void) => {
        if (!req.url?.startsWith("/auto-login")) return next();
        const url = new URL(req.url, "http://localhost");
        const token = url.searchParams.get("token") ?? "";
        const user = url.searchParams.get("user") ?? "{}";
        const redirect = url.searchParams.get("redirect") ?? "/dashboard";
        res.setHeader("Content-Type", "text/html");
        res.end(`<!DOCTYPE html><html><body><script>
localStorage.setItem('limo_token',${JSON.stringify(token)});
localStorage.setItem('limo_user',${JSON.stringify(user)});
location.href=${JSON.stringify(redirect)};
</script></body></html>`);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), autoLoginMiddleware()],
  server: { port: 3000, proxy: { "/v1": "http://localhost:3001" } },
});
