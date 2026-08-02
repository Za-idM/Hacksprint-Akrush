// PM2 config - run with: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "wab",
    script: "dist/index.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    env: { NODE_ENV: "production" },
    time: true,
    max_memory_restart: "512M",
    out_file: "logs/out.log",
    error_file: "logs/err.log"
  }]
};