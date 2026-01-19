export type TransactionType = 'BANK' | 'CASH' | 'CARD';

export interface Transaction {
    id: string;
    date: string;
    category: string;
    description: string;
    amount: number;
    runningBalance: number;
}

export interface MonthlyLedger {
    pk: string;
    month: string; // YYYY-MM
    type: TransactionType;
    openingBalance: number;
    closingBalance: number;
    transactions: Transaction[];
}

const CATEGORIES = ['Membership', 'Event Fee', 'Equipment', 'Reimbursement', 'Sponsorship', 'Misc'];

function generateTransactions(
    month: string,
    startBalance: number,
    isCreditCard: boolean
): { transactions: Transaction[]; endBalance: number } {
    const transactions: Transaction[] = [];
    let currentBalance = startBalance;

    // 2-6 transactions per month
    const numTx = Math.floor(Math.random() * 4) + 2;

    for (let i = 0; i < numTx; i++) {
        const amount = Number((Math.random() * 200 - (isCreditCard ? 20 : 50)).toFixed(2));
        currentBalance += amount;

        // Day of month 1-28
        const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');

        transactions.push({
            id: crypto.randomUUID(),
            date: `${month}-${day}`,
            category: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
            description: `Transaction ${i + 1}`,
            amount,
            runningBalance: Number(currentBalance.toFixed(2)),
        });
    }

    // Sort by date
    transactions.sort((a, b) => a.date.localeCompare(b.date));

    return { transactions, endBalance: Number(currentBalance.toFixed(2)) };
}

export function generateMockLedger(type: TransactionType): MonthlyLedger[] {
    const ledger: MonthlyLedger[] = [];
    const today = new Date();

    // Start 1 year ago
    let runningBalance = type === 'CARD' ? 0 : 1000; // Start with 1000 for assets, 0 for credit card

    for (let i = 13; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStr = d.toISOString().slice(0, 7); // YYYY-MM

        const { transactions, endBalance } = generateTransactions(monthStr, runningBalance, type === 'CARD');

        ledger.push({
            pk: `LEDGER#${type}#${monthStr}`,
            month: monthStr,
            type,
            openingBalance: Number(runningBalance.toFixed(2)),
            closingBalance: endBalance,
            transactions,
        });

        runningBalance = endBalance;
    }

    return ledger;
}
