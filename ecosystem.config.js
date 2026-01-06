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
        PORT: 4000
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'sir-frontend',
      script: 'serve',
      args: '-s dist -l 3000',
      cwd: '/home/ubuntu/sir-angular/frontend', // Cambiar por tu ruta en VPS
      instances: 1,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M'
    }
  ]
};
