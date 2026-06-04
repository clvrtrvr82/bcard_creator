module.exports = {
  apps: [
    {
      name: 'card-app',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '300M'
    }
  ]
};