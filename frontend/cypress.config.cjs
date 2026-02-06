const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    video: true,
    videoCompression: 0,
    baseUrl: 'http://localhost:5173',
    chromeWebSecurity: false,
    setupNodeEvents(on) {
      on('task', {
        log(message) {
          // eslint-disable-next-line no-console
          console.log(message);
          return null;
        },
      });
    },
    env: {
      APP_USER: process.env.APP_USER,
      APP_PASS: process.env.APP_PASS,
    },
    viewportHeight: 720,
    viewportWidth: 1280,
  },
});
