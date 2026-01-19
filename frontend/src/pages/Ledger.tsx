import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { fetchLedger } from '../api';
import type { MonthlyLedger, TransactionType } from '../mocks/ledgerData';
import { FaMoneyBillWave, FaUniversity, FaCreditCard, FaChevronRight, FaChevronDown } from 'react-icons/fa';
import './Ledger.css';

const ICONS = {
    CASH: <FaMoneyBillWave />,
    BANK: <FaUniversity />,
    CARD: <FaCreditCard />
};

export function Ledger() {
    const [type, setType] = useState<TransactionType>('BANK');
    const [data, setData] = useState<MonthlyLedger[]>([]);
    const [loading, setLoading] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Fetch data when Type toggles
    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const result = await fetchLedger(type);
                setData(result);
            } catch (err) {
                console.error(err);
                alert('Failed to load ledger');
            } finally {
                setLoading(false);
            }
        }
        load();
    }, [type]);

    // Scroll to bottom on data load
    useLayoutEffect(() => {
        if (data.length > 0) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [data, type]);

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
                    {data.map(month => (
                        <div key={month.month} className="month-block">
                            <div className="month-header">
                                <h3>{month.month}</h3>
                                <div className="month-summary">
                                    <span>Opening: ${month.openingBalance.toFixed(2)}</span>
                                    <span>Closing: ${month.closingBalance.toFixed(2)}</span>
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
                                        {month.transactions.map(tx => (
                                            <tr key={tx.id}>
                                                <td>{tx.date}</td>
                                                <td>{tx.category}</td>
                                                <td>{tx.description}</td>
                                                <td className={`right ${tx.amount < 0 ? 'neg' : 'pos'}`}>
                                                    {tx.amount.toFixed(2)}
                                                </td>
                                                <td className="right">{tx.runningBalance.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                    <div ref={bottomRef} className="bottom-marker" />
                </div>
            )}
        </div>
    );
}
