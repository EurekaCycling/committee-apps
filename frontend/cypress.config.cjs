const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5173',
    chromeWebSecurity: false,
    env: {
      APP_USER: process.env.APP_USER,
      APP_PASS: process.env.APP_PASS,
    },
  },
});
