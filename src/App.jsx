import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import { PAYMENT_LOG_ABI, PAYMENT_LOG_ADDRESS } from './contract.js';

const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const fujiChainId = '0xa869';
const maxLabelLength = 120;
const minAmountAvax = 0.0001;
const maxAmountAvax = 1000;

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return NaN;
  return Number(String(value).replace(/,/g, '').trim());
}

function money(value) {
  if (!Number.isFinite(value)) return 'KSh 0';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(value);
}

function months(value) {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(1);
}

function percent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(value) {
  if (!Number.isFinite(value)) return '0x';
  return `${value.toFixed(2)}x`;
}

function normalizeRows(rawRows) {
  return rawRows
    .map((row) => {
      const amount = parseNumber(row.Amount ?? row.amount ?? row.Debit ?? row.debit ?? row.Credit ?? row.credit ?? row['Debit / Credit'] ?? row['debit / credit']);
      const balance = parseNumber(row.Balance ?? row.balance);
      return {
        date: row.Date ?? row.date ?? '',
        description: String(row.Description ?? row.description ?? row.Narration ?? row.narration ?? row.Details ?? row.details ?? '').slice(0, maxLabelLength),
        amount,
        balance: Number.isFinite(balance) ? balance : undefined,
      };
    })
    .filter((row) => Number.isFinite(row.amount));
}

async function ensureFujiNetwork() {
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: fujiChainId }] });
  } catch (switchError) {
    if (switchError?.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: fujiChainId,
          chainName: 'Fuji Testnet',
          nativeCurrency: { name: 'Fuji AVAX', symbol: 'AVAX', decimals: 18 },
          rpcUrls: ['https://api.avax-testnet.com/ext/bc/C/rpc'],
          blockExplorerUrls: ['https://testnet.snowtrace.io'],
        }],
      });
      return;
    }
    throw switchError;
  }
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [score, setScore] = useState(null);
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [recordLabel, setRecordLabel] = useState('Customer deposit - Fuji test');
  const [recordAmount, setRecordAmount] = useState('0.01');
  const [recordStatus, setRecordStatus] = useState('');
  const [error, setError] = useState('');

  async function loadPayments() {
    try {
      const response = await fetch(`${backendUrl}/onchain-payments`);
      const data = await response.json();
      setPayments(data.payments || []);
    } catch (err) {
      setPayments([]);
    }
  }

  useEffect(() => {
    loadPayments();
  }, []);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const normalized = normalizeRows(result.data);
        setRows(normalized);
        setScore(null);
        setReport('');
        setError('');
      },
      error: (err) => setError(err.message),
    });
  }

  async function scoreCsv() {
    if (!rows.length) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${backendUrl}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: rows }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scoring failed');
      setScore(data);
      setReport('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    if (!score) return;
    setReportLoading(true);
    setError('');
    try {
      const response = await fetch(`${backendUrl}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Report failed');
      setReport(data.report || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setReportLoading(false);
    }
  }

  function validRecordInput() {
    const amount = Number(recordAmount);
    if (recordLabel.trim().length === 0 || recordLabel.trim().length > maxLabelLength) {
      setRecordStatus(`Payment label must be 1-${maxLabelLength} characters.`);
      return false;
    }
    if (!Number.isFinite(amount) || amount < minAmountAvax || amount > maxAmountAvax) {
      setRecordStatus(`Enter an AVAX amount between ${minAmountAvax} and ${maxAmountAvax}.`);
      return false;
    }
    return true;
  }

  async function recordPayment() {
    if (!PAYMENT_LOG_ADDRESS) {
      setRecordStatus('PaymentLog address is not configured yet.');
      return;
    }
    if (!window.ethereum) {
      setRecordStatus('Open Core Wallet or MetaMask to record a Fuji payment.');
      return;
    }
    if (!validRecordInput()) return;

    setRecordStatus('Switching wallet to Fuji testnet...');
    setError('');

    try {
      await ensureFujiNetwork();
      setRecordStatus('Requesting wallet signature...');
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(PAYMENT_LOG_ADDRESS, PAYMENT_LOG_ABI, signer);
      const tx = await contract.recordPayment(recordLabel.trim(), parseUnits(recordAmount, 18));
      setRecordStatus('Waiting for Fuji confirmation...');
      await tx.wait();
      setRecordStatus(`Recorded on Fuji. Tx: ${tx.hash}`);
      setRecordLabel('Customer deposit - Fuji test');
      setRecordAmount('0.01');
      await loadPayments();
    } catch (err) {
      setRecordStatus(err?.message || 'Payment was not recorded.');
    }
  }

  return (
    <main className="app">
      <section className="hero">
        <div>
          <p className="eyebrow">Kuzana Bounty 1 MVP</p>
          <h1>Startup Cash Flow Risk Tool</h1>
          <p>Upload a simulated Zoho CSV, score runway and concentration risk, record one Fuji testnet payment, and generate a plain-language finance note.</p>
        </div>
        <div className="pill">Simulated Zoho via CSV</div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>1. CSV cash-flow upload</h2>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} />
          <a className="link" href="/sample-transactions.csv" download>Download sample SME CSV</a>
          <button onClick={scoreCsv} disabled={!rows.length || loading}>{loading ? 'Scoring...' : 'Score CSV'}</button>
          {rows.length > 0 && <p className="muted">{rows.length} transactions loaded. Raw rows never leave your browser until you click Score CSV.</p>}
        </div>

        <div className="card">
          <h2>2. Risk score</h2>
          {!score ? (
            <p className="muted">Upload and score a CSV to see balance, burn rate, runway, and flags.</p>
          ) : (
            <div className="metrics">
              <div><span>Balance</span><strong>{money(score.balance)}</strong></div>
              <div><span>Monthly burn</span><strong>{money(score.burnRate)}</strong></div>
              <div><span>Runway</span><strong>{months(score.runwayMonths)} months</strong></div>
              <div><span>Risk</span><strong className={score.riskLevel}>{score.riskLevel}</strong></div>
              {score.metrics && (
                <>
                  <div><span>Outflow / inflow</span><strong>{ratio(score.metrics.inflowOutflowRatio)}</strong></div>
                  <div><span>Top inflow share</span><strong>{percent(score.metrics.topInflowShare)}</strong></div>
                  <div><span>Largest expense share</span><strong>{percent(score.metrics.largestExpenseShare)}</strong></div>
                  <div><span>Burn acceleration</span><strong>{percent(score.metrics.burnAcceleration)}</strong></div>
                </>
              )}
            </div>
          )}
          {score?.flags?.length > 0 && (
            <ul className="flags">
              {score.flags.map((flag, index) => <li key={index}>{flag}</li>)}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>3. AI finance note</h2>
          <button onClick={generateReport} disabled={!score || reportLoading}>{reportLoading ? 'Generating...' : 'Generate Gemini report'}</button>
          {report && <article className="report">{report}</article>}
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <h2>4. Record Fuji payment</h2>
          <input value={recordLabel} onChange={(event) => setRecordLabel(event.target.value)} placeholder="Payment label" />
          <input value={recordAmount} onChange={(event) => setRecordAmount(event.target.value)} placeholder="Amount AVAX" />
          <button onClick={recordPayment}>Record Payment</button>
          {recordStatus && <p className="muted">{recordStatus}</p>}
          {!PAYMENT_LOG_ADDRESS && <p className="warning">Set VITE_PAYMENT_LOG_ADDRESS after deploying PaymentLog.sol.</p>}
        </div>

        <div className="card">
          <h2>5. Recent on-chain payments</h2>
          {payments.length === 0 ? (
            <p className="muted">No Fuji payments loaded yet.</p>
          ) : (
            <ul className="payments">
              {payments.map((payment) => (
                <li key={payment.transactionHash}>
                  <strong>{payment.label}</strong>
                  <span>{Number(payment.amount).toFixed(4)} AVAX</span>
                  <small>{payment.sender}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {error && <div className="error">{error}</div>}
    </main>
  );
}
