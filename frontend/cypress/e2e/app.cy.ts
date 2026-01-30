describe('app', () => {
  it('opens the app', () => {
    const username = Cypress.env('APP_USER');
    const password = Cypress.env('APP_PASS');

    cy.visit('/');
    cy.get('input[name="username"]').type(username);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
  });
});
