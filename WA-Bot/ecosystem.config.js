module.exports = {
  apps: [
    {
      name: 'wa-bot',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1, // MUST be 1 — whatsapp-web.js cannot run multiple instances
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      log_file: 'logs/pm2-combined.log',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
