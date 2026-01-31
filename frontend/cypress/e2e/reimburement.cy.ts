describe('app', () => {
  it('opens the app', () => {
    const username = Cypress.env('APP_USER');
    const password = Cypress.env('APP_PASS');

    cy.visit('/');
    cy.get('input[name="username"]').type(username);
    cy.get('input[name="password"]').type(password);
    cy.get('button[type="submit"]').click();
    cy.contains('a', 'Reimbursement').click();
    cy.get('#receipt-upload').scrollIntoView();
    cy.get('#receipt-upload').selectFile('/home/jason/Downloads/EurekaCyclingClub-SquareSpace2026.pdf', { force: true });
    cy.contains('EurekaCyclingClub-SquareSpace2026.pdf');
    cy.get('[data-testid="reimbursement-category"]').select('Website & IT');
    cy.get('[data-testid="reimbursement-purchase-date"]').type('2026-01-19');
    cy.get('[data-testid="reimbursement-amount"]').type('332.64');
    cy.get('[data-testid="reimbursement-description"]').type('eurekacycling.org.au website');
    cy.contains('label', 'Add new member').click();
    cy.get('[data-testid="reimbursement-member-name"]').type('Jason Hendry');
    cy.get('[data-testid="reimbursement-member-phone"]').type('0490324140');
    cy.get('[data-testid="reimbursement-payid"]').type('jason@rain.com.au');
    cy.get('[data-testid="reimbursement-submit"]').click();
  });
});
