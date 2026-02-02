const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    video: true,
    videoCompression: 0,
    baseUrl: 'http://localhost:5173',
    chromeWebSecurity: false,
    env: {
      APP_USER: process.env.APP_USER,
      APP_PASS: process.env.APP_PASS,
    },
    viewportHeight: 720,
    viewportWidth: 1280,
  },
});
