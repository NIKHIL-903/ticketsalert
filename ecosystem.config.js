module.exports = {
  apps: [
    {
      name: 'bms-seat-alert',
      script: 'src/index.js',
      windowsHide: true,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
