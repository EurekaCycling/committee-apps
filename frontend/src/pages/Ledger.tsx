import { Fragment, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FaMoneyBillWave, FaUniversity, FaCreditCard, FaCheck, FaTimes } from 'react-icons/fa';
import { apiFetch, createLedgerTransaction, fetchCategories, updateLedgerTransaction } from '../api';
import type { MonthlyLedger, TransactionType } from '../mocks/ledgerData';
import { usePageTitle } from '../hooks/usePageTitle';
import './Ledger.css';

const ICONS = {
    CASH: <FaMoneyBillWave />,
    BANK: <FaUniversity />,
    CARD: <FaCreditCard />
};

const getMonthKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

const getDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getDaysOptions = (monthStr: string) => {
    const [year, month] = monthStr.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const options = [] as { value: string; label: string }[];
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const dayName = date.toLocaleDateString('en-AU', { weekday: 'long' });
        const value = `${monthStr}-${String(d).padStart(2, '0')}`;
        options.push({ value, label: `${d} - ${dayName}` });
    }
    return options;
};

export function Ledger() {
    usePageTitle('Ledger');
    const [type, setType] = useState<TransactionType>('CASH');
    const [ledgers, setLedgers] = useState<MonthlyLedger[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editErrors, setEditErrors] = useState<Record<string, string>>({});
    const [editing, setEditing] = useState<{
        txId: string;
        field: 'category' | 'description';
        value: string;
    } | null>(null);
    const [categories, setCategories] = useState<string[]>([]);
    const [draft, setDraft] = useState({
        date: getDateKey(new Date()),
        category: '',
        description: '',
        amount: ''
    });

    useEffect(() => {
        async function loadCategories() {
            try {
                const cats = await fetchCategories();
                setCategories(cats);
            } catch (err) {
                console.error('Failed to load categories', err);
            }
        }

        loadCategories();
    }, []);

    useEffect(() => {
        let isActive = true;

        const fetchMonthLedger = async (month: string) => {
            const res = await apiFetch(`/ledger?type=${type}&month=${month}`);
            const ledger = (await res.json()) as MonthlyLedger;
            return { ...ledger, month: ledger.month || month };
        };

        async function load() {
            const currentDate = new Date();
            currentDate.setDate(1);
            const monthsToFetch: string[] = [];
            for (let i = 12; i >= 0; i--) {
                const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
                monthsToFetch.push(getMonthKey(date));
            }
            setLoading(true);
            setError(null);
            setLedgers([]);
            setEditing(null);
            setEditErrors({});
            setDraft(prev => ({
                ...prev,
                date: getDateKey(new Date())
            }));
            try {
                for (const month of monthsToFetch) {
                    const ledger = await fetchMonthLedger(month);
                    if (!isActive) {
                        return;
                    }
                    setLedgers(prev => [...prev, ledger]);
                }
            } catch (err) {
                console.error(err);
                if (isActive) {
                    setError('Failed to load ledger data. Please refresh and try again.');
                }
            } finally {
                if (isActive) {
                    setLoading(false);
                }
            }
        }

        load();

        return () => {
            isActive = false;
        };
    }, [type]);

    const handleDraftUpdate = (field: 'date' | 'category' | 'description' | 'amount', value: string) => {
        setDraft(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const beginEdit = (txId: string, field: 'category' | 'description', value: string) => {
        setEditing({ txId, field, value });
        setEditErrors(prev => {
            if (!prev[txId]) {
                return prev;
            }
            const next = { ...prev };
            delete next[txId];
            return next;
        });
    };

    const cancelEdit = () => {
        setEditing(null);
    };

    const dismissEditError = (txId: string) => {
        setEditErrors(prev => {
            if (!prev[txId]) {
                return prev;
            }
            const next = { ...prev };
            delete next[txId];
            return next;
        });
    };

    const handleEditKeyDown = (
        event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
        tx: MonthlyLedger['transactions'][number],
        monthLabel: string
    ) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void saveEdit(tx, monthLabel);
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelEdit();
        }
    };

    const saveEdit = async (tx: MonthlyLedger['transactions'][number], monthLabel: string) => {
        if (!editing || editing.txId !== tx.id) {
            return;
        }
        const field = editing.field;
        const currentValue = field === 'category' ? tx.category : tx.description;
        if (editing.value === currentValue) {
            setEditing(null);
            return;
        }

        try {
            await updateLedgerTransaction({
                month: monthLabel,
                type,
                transactionId: tx.id,
                field,
                value: editing.value
            });
            setLedgers(prev => prev.map(ledger => {
                if (ledger.month !== monthLabel) {
                    return ledger;
                }
                const updatedTransactions = ledger.transactions?.map(item => {
                    if (item.id !== tx.id) {
                        return item;
                    }
                    return {
                        ...item,
                        [field]: editing.value
                    };
                }) ?? [];
                return {
                    ...ledger,
                    transactions: updatedTransactions
                };
            }));
            setEditing(null);
            setEditErrors(prev => {
                if (!prev[tx.id]) {
                    return prev;
                }
                const next = { ...prev };
                delete next[tx.id];
                return next;
            });
        } catch (err) {
            console.error(err);
            const message = err instanceof Error
                ? err.message
                : 'Failed to update transaction. Please try again.';
            setEditErrors(prev => ({
                ...prev,
                [tx.id]: message
            }));
        }
    };

    const handleAddTransaction = async () => {
        const currentMonth = getMonthKey(new Date());
        if (!draft.date || !draft.category || draft.amount === '') {
            setError('Please fill in date, category, and amount.');
            return;
        }

        const amountValue = Number(draft.amount);
        if (Number.isNaN(amountValue)) {
            setError('Amount must be a number.');
            return;
        }

        setError(null);
        try {
            await createLedgerTransaction(type, {
                date: draft.date,
                category: draft.category,
                description: draft.description,
                amount: amountValue
            });

            const res = await apiFetch(`/ledger?type=${type}&month=${currentMonth}`);
            const ledger = (await res.json()) as MonthlyLedger;
            const refreshedLedger = { ...ledger, month: ledger.month || currentMonth };
            setLedgers(prev => prev.map(item => (item.month === currentMonth ? refreshedLedger : item)));

            setDraft({
                date: getDateKey(new Date()),
                category: '',
                description: '',
                amount: ''
            });
        } catch (err) {
            console.error(err);
            const message = err instanceof Error
                ? err.message
                : 'Failed to add transaction. Please try again.';
            setError(message);
        }
    };

    useEffect(() => {
        if (loading || ledgers.length === 0) {
            return;
        }

        const currentMonth = getMonthKey(new Date());
        const target = document.querySelector(`[data-ledger-month="${currentMonth}"]`);
        if (target) {
            target.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
    }, [loading, ledgers]);

    return (
        <div className="page-container ledger-page">
            <div className="ledger-header">
                <h1>Ledger</h1>
                <div className="type-toggle">
                    {(['BANK', 'CASH', 'CARD'] as TransactionType[]).map(t => (
                        <button
                            key={t}
                            className={`toggle-btn ${type === t ? 'active' : ''}`}
                            onClick={() => setType(t)}
                        >
                            <span className="icon">{ICONS[t]}</span>
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="loading">Loading...</div>
            ) : (
                <div className="ledger-content">
                    {ledgers.length === 0 ? (
                        <div className="loading">No ledger data available.</div>
                    ) : (
                        ledgers.map(ledger => {
                            const currentMonth = getMonthKey(new Date());
                            const monthLabel = ledger.month;
                            const transactions = ledger.transactions ?? [];
                            const isCurrentMonth = monthLabel === currentMonth;
                            return (
                                <div key={monthLabel} className="month-block" data-ledger-month={monthLabel}>
                                    <div className="month-header">
                                        <div className="month-title">
                                            <h3>{monthLabel}</h3>
                                        </div>
                                        <div className="month-actions">
                                            <div className="month-summary">
                                                <span>Opening: ${ledger.openingBalance.toFixed(2)}</span>
                                                <span>Closing: ${ledger.closingBalance.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="transactions-list">
                                        <table className="transactions-table">
                                            <thead>
                                                <tr>
                                                    <th>Date</th>
                                                    <th>Category</th>
                                                    <th>Description</th>
                                                    <th className="right">Amount</th>
                                                    <th className="right">Balance</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {transactions.map(tx => {
                                                    const rowError = editErrors[tx.id];
                                                    const isEditingCategory = editing?.txId === tx.id && editing.field === 'category';
                                                    const isEditingDescription = editing?.txId === tx.id && editing.field === 'description';
                                                    return (
                                                        <Fragment key={tx.id}>
                                                            {rowError && (
                                                                <tr className="inline-edit-error-row">
                                                                    <td colSpan={5}>
                                                                        <div className="inline-edit-error" role="status">
                                                                            <span>{rowError}</span>
                                                                            <button
                                                                                type="button"
                                                                                className="ledger-alert-close"
                                                                                aria-label="Dismiss error"
                                                                                onClick={() => dismissEditError(tx.id)}
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                            <tr className="transaction-row">
                                                                <td>{tx.date}</td>
                                                                <td
                                                                    className="editable-cell"
                                                                    onClick={() => beginEdit(tx.id, 'category', tx.category)}
                                                                >
                                                                    {isEditingCategory ? (
                                                                        <div className="inline-edit" onClick={event => event.stopPropagation()}>
                                                                            <select
                                                                                value={editing?.value ?? ''}
                                                                                onChange={event => setEditing(prev => (prev ? { ...prev, value: event.target.value } : prev))}
                                                                                onKeyDown={event => handleEditKeyDown(event, tx, monthLabel)}
                                                                            >
                                                                                {categories.map(category => (
                                                                                    <option key={category} value={category}>{category}</option>
                                                                                ))}
                                                                            </select>
                                                                            <div className="inline-edit-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="inline-edit-btn confirm"
                                                                                aria-label="Save category"
                                                                                onClick={event => {
                                                                                    event.stopPropagation();
                                                                                    void saveEdit(tx, monthLabel);
                                                                                }}
                                                                            >
                                                                                <FaCheck />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="inline-edit-btn cancel"
                                                                                aria-label="Cancel edit"
                                                                                onClick={event => {
                                                                                    event.stopPropagation();
                                                                                    cancelEdit();
                                                                                }}
                                                                            >
                                                                                    <FaTimes />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="editable-value">{tx.category}</span>
                                                                    )}
                                                                </td>
                                                                <td
                                                                    className="editable-cell"
                                                                    onClick={() => beginEdit(tx.id, 'description', tx.description)}
                                                                >
                                                                    {isEditingDescription ? (
                                                                        <div className="inline-edit" onClick={event => event.stopPropagation()}>
                                                                            <input
                                                                                type="text"
                                                                                value={editing?.value ?? ''}
                                                                                onChange={event => setEditing(prev => (prev ? { ...prev, value: event.target.value } : prev))}
                                                                                onKeyDown={event => handleEditKeyDown(event, tx, monthLabel)}
                                                                            />
                                                                            <div className="inline-edit-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="inline-edit-btn confirm"
                                                                                aria-label="Save description"
                                                                                onClick={event => {
                                                                                    event.stopPropagation();
                                                                                    void saveEdit(tx, monthLabel);
                                                                                }}
                                                                            >
                                                                                <FaCheck />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="inline-edit-btn cancel"
                                                                                aria-label="Cancel edit"
                                                                                onClick={event => {
                                                                                    event.stopPropagation();
                                                                                    cancelEdit();
                                                                                }}
                                                                            >
                                                                                    <FaTimes />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <span className="editable-value">{tx.description}</span>
                                                                    )}
                                                                </td>
                                                                <td className={`right ${tx.amount < 0 ? 'neg' : 'pos'}`}>
                                                                    {tx.amount.toFixed(2)}
                                                                </td>
                                                                <td className="right">{tx.runningBalance.toFixed(2)}</td>
                                                            </tr>
                                                        </Fragment>
                                                    );
                                                })}
                                                {isCurrentMonth && (
                                                    <>
                                                        {error && (
                                                            <tr className="add-transaction-row">
                                                                <td colSpan={5}>
                                                                    <div className="ledger-alert error" role="status">
                                                                        <span>{error}</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                        <tr className="add-transaction-row">
                                                            <td>
                                                                <select
                                                                    value={draft.date}
                                                                    onChange={event => handleDraftUpdate('date', event.target.value)}
                                                                >
                                                                    {getDaysOptions(monthLabel).map(option => (
                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td>
                                                                <select
                                                                    value={draft.category}
                                                                    onChange={event => handleDraftUpdate('category', event.target.value)}
                                                                >
                                                                    <option value="">Select...</option>
                                                                    {categories.map(category => (
                                                                        <option key={category} value={category}>{category}</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Description"
                                                                    value={draft.description}
                                                                    onChange={event => handleDraftUpdate('description', event.target.value)}
                                                                />
                                                            </td>
                                                            <td className="right">
                                                                <input
                                                                    type="number"
                                                                    step="0.01"
                                                                    placeholder="0.00"
                                                                    className="amount-input"
                                                                    value={draft.amount}
                                                                    onChange={event => handleDraftUpdate('amount', event.target.value)}
                                                                />
                                                            </td>
                                                            <td className="right">
                                                                <button type="button" className="add-btn" onClick={handleAddTransaction}>
                                                                    Add
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    </>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
