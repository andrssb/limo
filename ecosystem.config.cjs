module.exports = {
  apps: [
    {
      name: "limo-api",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "apps/api/src/index.ts",
      node_args: "--env-file=.env",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      max_memory_restart: "512M",
      env: { NODE_ENV: "development" },
      error_file: "logs/api-error.log",
      out_file:   "logs/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
