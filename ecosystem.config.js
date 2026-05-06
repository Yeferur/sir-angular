module.exports = {
  apps: [
    {
      name: 'sir-backend',
      script: './server.js',
      cwd: '/home/ubuntu/sir-angular/backend', // Cambiar por tu ruta en VPS
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        WEBSOCKET_PORT: 6000
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
};
