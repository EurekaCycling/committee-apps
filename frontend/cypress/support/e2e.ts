type ConsoleEntry = string;

const stringifyArg = (arg: unknown) => {
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch (error) {
    return String(arg);
  }
};

const recordConsoleError = (win: Window, args: unknown[]) => {
  if (!win.__consoleErrors) {
    win.__consoleErrors = [];
  }
  win.__consoleErrors.push(args.map(stringifyArg).join(' '));
};

beforeEach(() => {
  cy.on('window:before:load', (win) => {
    win.__consoleErrors = [];
    const originalError = win.console.error.bind(win.console);
    win.console.error = (...args: unknown[]) => {
      originalError(...args);
      recordConsoleError(win, args);
    };
  });
});

afterEach(() => {
  cy.window({ log: false }).then((win) => {
    const errors: ConsoleEntry[] = win.__consoleErrors ?? [];
    if (errors.length === 0) {
      return;
    }
    const message = ['Browser console errors:', ...errors.map((entry) => `- ${entry}`)].join('\n');
    cy.task('log', message, { log: false });
  });
});

export {};
