import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { BrowserProvider, Contract, parseUnits } from 'ethers';
import { PAYMENT_LOG_ABI, PAYMENT_LOG_ADDRESS as ENV_PAYMENT_LOG_ADDRESS } from './contract.js';

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
  if (!Number.isFinite(value)) return '0.0';
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

function getRiskConfig(score) {
  if (!score) return { tone: 'neutral', percent: 0, label: 'Awaiting CSV' };
  if (score.riskLevel === 'high') return { tone: 'danger', percent: 88, label: 'High risk' };
  if (score.riskLevel === 'medium') return { tone: 'warning', percent: 58, label: 'Watchlist' };
  return { tone: 'safe', percent: 24, label: 'Low risk' };
}

function runwayLabel(score) {
  if (!score) return 'No runway calculated yet';
  if (!Number.isFinite(score.runwayMonths)) return 'Runway unclear';
  if (score.runwayMonths < 1) return 'Critical runway';
  if (score.runwayMonths < 3) return 'Below 3-month runway';
  if (score.runwayMonths < 6) return 'Thin runway';
  return 'Healthy runway';
}

function formatDate(timestamp) {
  if (!timestamp) return 'No timestamp';
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return 'Pending timestamp';
  return date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

function MetricCard({ label, value, hint, tone = 'default' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function SourceCard({ title, description, badge }) {
  return (
    <div className="source-card">
      <div className="source-card-head">
        <span>{badge}</span>
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function FlagList({ flags }) {
  if (!flags?.length) {
    return <p className="empty-state">No material flags detected from the uploaded CSV yet.</p>;
  }

  return (
    <ul className="flag-list">
      {flags.map((flag, index) => (
        <li key={index}>
          <span>{index + 1}</span>
          <p>{flag}</p>
        </li>
      ))}
    </ul>
  );
}

function CashFlowBars({ transactions }) {
  const recent = transactions?.slice(-10) || [];
  if (!recent.length) return <p className="empty-state">Cash movement preview appears after scoring.</p>;

  const max = Math.max(...recent.map((row) => Math.abs(row.amount)), 1);

  return (
    <div className="cash-bars" aria-label="Recent cash movement preview">
      {recent.map((row, index) => {
        const height = Math.max(10, Math.round((Math.abs(row.amount) / max) * 100));
        return (
          <div className="cash-bar" key={`${row.date}-${row.description}-${index}`}>
            <i className={row.amount >= 0 ? 'inflow' : 'outflow'} style={{ height: `${height}%` }} />
            <span>{row.date ? row.date.slice(5) : `Tx ${index + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function PaymentList({ payments }) {
  if (!payments?.length) {
    return <p className="empty-state">No Fuji payments have been recorded yet.</p>;
  }

  return (
    <div className="payment-list">
      {payments.map((payment) => (
        <div className="payment-item" key={payment.transactionHash}>
          <div>
            <strong>{payment.label}</strong>
            <small>{formatDate(payment.timestamp)}</small>
          </div>
          <div className="payment-amount">{Number(payment.amount).toFixed(4)} AVAX</div>
          <code>{payment.sender}</code>
          {payment.explorerUrl && <a className="inline-link" href={payment.explorerUrl} target="_blank" rel="noreferrer">View tx</a>}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [score, setScore] = useState(null);
  const [report, setReport] = useState('');
  const [reportGeneratedAt, setReportGeneratedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [config, setConfig] = useState(null);
  const [paymentLogAddress, setPaymentLogAddress] = useState(ENV_PAYMENT_LOG_ADDRESS);
  const [recordLabel, setRecordLabel] = useState('Customer deposit - Fuji test');
  const [recordAmount, setRecordAmount] = useState('0.01');
  const [recordStatus, setRecordStatus] = useState('');
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('overview');

  const risk = getRiskConfig(score);
  const runwayPercent = score && Number.isFinite(score.runwayMonths) ? Math.min(100, Math.max(0, (score.runwayMonths / 6) * 100)) : 0;

  async function loadConfig() {
    try {
      const response = await fetch(`${backendUrl}/config`);
      const data = await response.json();
      setConfig(data);
      setPaymentLogAddress(data.paymentLogAddress || ENV_PAYMENT_LOG_ADDRESS);
    } catch (err) {
      setPaymentLogAddress(ENV_PAYMENT_LOG_ADDRESS);
    }
  }

  async function loadPayments() {
    try {
      const response = await fetch(`${backendUrl}/onchain-payments`);
      const data = await response.json();
      setPayments(data.payments || []);
      if (data.contractExplorerUrl) setPaymentLogAddress(data.contractExplorerUrl);
    } catch (err) {
      setPayments([]);
    }
  }

  useEffect(() => {
    loadConfig();
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
        setReportGeneratedAt('');
        setError('');
        setRecordStatus('');
      },
      error: (err) => setError(err.message),
    });
  }

  async function scoreCsv() {
    if (!rows.length) return;
    setLoading(true);
    setError('');
    setRecordStatus('');
    setActiveSection('score');
    try {
      const response = await fetch(`${backendUrl}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: rows }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || 'Scoring failed');
      setScore(data);
      setReport('');
      setReportGeneratedAt('');
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
    setActiveSection('report');
    try {
      const response = await fetch(`${backendUrl}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || 'Report failed');
      setReport(data.report || '');
      setReportGeneratedAt(data.generatedAt ? new Date(data.generatedAt).toLocaleString('en-KE') : '');
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
    if (!paymentLogAddress || paymentLogAddress.startsWith('https://')) {
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
    setActiveSection('chain');

    try {
      await ensureFujiNetwork();
      setRecordStatus('Requesting wallet signature...');
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(paymentLogAddress, PAYMENT_LOG_ABI, signer);
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

  const navItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'upload', label: 'CSV' },
    { id: 'score', label: 'Score' },
    { id: 'report', label: 'Report' },
    { id: 'chain', label: 'Chain' },
  ];

  return (
    <main className="app-shell">
      <div className="topbar">
        <a href="#overview" className="brand" onClick={() => setActiveSection('overview')}>
          <span className="brand-mark" />
          <div>
            <strong>Mizani</strong>
            <span>Cash Flow Risk Tool</span>
          </div>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.id} className={activeSection === item.id ? 'active' : ''} onClick={() => setActiveSection(item.id)}>{item.label}</button>
          ))}
        </nav>
        <a className="topbar-cta" href="#upload">Start demo</a>
        <div className="topbar-status">
          <span className="pulse" />
          {config?.version || 'MVP'}
        </div>
      </div>

      <section className="hero" id="overview">
        <div className="hero-copy">
          <p className="eyebrow">Kuzana Bounty 1 · Stage 1 MVP</p>
          <h1>See cash-flow risk before it becomes a founder emergency.</h1>
          <p>Upload a simulated Zoho CSV, score runway and concentration risk, generate a plain-language finance note, and pair it with one Fuji testnet payment event.</p>
          <div className="hero-actions">
            <a href="#upload" className="primary-link">Start with CSV</a>
            <a href="#chain" className="secondary-link">View on-chain proof</a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="hero-panel-header">
            <span>Live risk position</span>
            <strong>{risk.label}</strong>
          </div>
          <div className={`risk-gauge ${risk.tone}`} style={{ '--risk-angle': `${risk.percent * 3.6}deg` }}>
            <div>
              <strong>{score ? score.riskLevel : 'Pending'}</strong>
              <span>{runwayLabel(score)}</span>
            </div>
          </div>
          <div className="runway-copy">
            <span>Runway target</span>
            <strong>{score ? `${months(score.runwayMonths)} months` : 'Upload CSV'}</strong>
            <div className="runway-bar"><i style={{ width: `${runwayPercent}%` }} /></div>
          </div>
        </div>
      </section>

      <section className="source-strip" aria-label="Data sources">
        <SourceCard title="Simulated Zoho CSV" badge="CSV" description="Fast MVP path for founders without a live accounting integration." />
        <SourceCard title="Rule-based scorer" badge="Rules" description="Burn rate, runway, concentration, burn acceleration, and unusual withdrawals." />
        <SourceCard title="Gemini finance note" badge="AI" description="Plain-language explanation written from scored numbers only." />
        <SourceCard title="Fuji payment log" badge="Chain" description="One on-chain event used as a second data source for the MVP." />
      </section>

      <section className="policy" aria-label="User policy and reliance information">
        <div>
          <p className="eyebrow">Reliance policy</p>
          <h2>Use this as an early-warning cockpit, not as accounting advice.</h2>
        </div>
        <div className="policy-grid">
          <div><strong>Use for</strong><p>Founder checks, cash-flow conversations, and deciding what to reconcile first.</p></div>
          <div><strong>Do not use for</strong><p>Tax, audit, credit, legal, or investment decisions without human review.</p></div>
          <div><strong>CSV source</strong><p>Zoho is simulated through CSV upload. Confirm important figures against the actual accounting system.</p></div>
          <div><strong>AI note</strong><p>Gemini summarizes the scored data and may miss context not present in the CSV.</p></div>
          <div><strong>On-chain proof</strong><p>Fuji events prove a wallet recorded data, not that a real customer paid unless verified offline.</p></div>
          <div><strong>Privacy</strong><p>Do not upload unnecessary personal data. Raw CSV rows are only sent when you click Score CSV.</p></div>
        </div>
      </section>

      <section className="dashboard-grid" id="upload">
        <div className="card upload-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 1</p>
              <h2>Upload cash-flow CSV</h2>
            </div>
            <span className="step-badge">{rows.length} rows</span>
          </div>
          <div className="upload-zone">
            <input aria-label="Upload CSV transactions" type="file" accept=".csv,text/csv" onChange={handleFile} />
            <div>
              <strong>Drop or choose a CSV</strong>
              <p>Columns can include Date, Description, Amount, Credit, Debit, and Balance.</p>
            </div>
          </div>
          <a className="inline-link" href="/sample-transactions.csv" download>Download sample SME CSV</a>
          <button onClick={scoreCsv} disabled={!rows.length || loading}>{loading ? 'Scoring...' : 'Score CSV'}</button>
          {rows.length > 0 && <p className="helper-text">Raw rows stay in the browser until you submit them for scoring.</p>}
        </div>

        <div className="card score-card" id="score">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 2</p>
              <h2>Risk score</h2>
            </div>
            <span className={`risk-pill ${score?.riskLevel || 'neutral'}`}>{score?.riskLevel || 'No score'}</span>
          </div>

          {!score ? (
            <div className="empty-panel">
              <strong>No score yet</strong>
              <p>Upload and score a CSV to calculate balance, burn rate, runway, and startup-specific risk signals.</p>
            </div>
          ) : (
            <>
              <div className="metric-grid">
                <MetricCard label="Balance" value={money(score.balance)} tone="blue" />
                <MetricCard label="Monthly burn" value={money(score.burnRate)} tone="purple" />
                <MetricCard label="Runway" value={`${months(score.runwayMonths)} mo`} tone={score.runwayMonths < 3 ? 'danger' : 'safe'} />
                <MetricCard label="Outflow / inflow" value={ratio(score.metrics?.inflowOutflowRatio)} tone="amber" />
                <MetricCard label="Top inflow share" value={percent(score.metrics?.topInflowShare)} tone="amber" />
                <MetricCard label="Largest expense" value={percent(score.metrics?.largestExpenseShare)} tone="purple" />
              </div>
              <div className="insight-row">
                <div><span>Burn acceleration</span><strong>{percent(score.metrics?.burnAcceleration)}</strong></div>
                <div><span>Days since inflow</span><strong>{score.metrics?.daysSinceLastInflow ?? 'N/A'}</strong></div>
                <div><span>Has balance column</span><strong>{score.metrics?.hasBalanceColumn ? 'Yes' : 'No'}</strong></div>
              </div>
              <div className="card-section">
                <h3>Cash movement preview</h3>
                <CashFlowBars transactions={score.transactions} />
              </div>
            </>
          )}

          <div className="card-section">
            <h3>Flags to investigate</h3>
            <FlagList flags={score?.flags} />
          </div>
        </div>

        <div className="card report-card" id="report">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 3</p>
              <h2>AI finance note</h2>
            </div>
          </div>
          <p className="helper-text">Generate a concise controller-style note from the scored numbers. The report excludes raw CSV rows.</p>
          <button onClick={generateReport} disabled={!score || reportLoading}>{reportLoading ? 'Generating...' : 'Generate Gemini report'}</button>
          {report ? (
            <>
              {reportGeneratedAt && <p className="report-meta">Generated {reportGeneratedAt}</p>}
              <article className="report">{report}</article>
            </>
          ) : <div className="report-placeholder">The finance note will appear here after scoring.</div>}
        </div>
      </section>

      <section className="dashboard-grid split" id="chain">
        <div className="card chain-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 4</p>
              <h2>Record Fuji payment</h2>
            </div>
            <span className="chain-badge">Fuji testnet</span>
          </div>
          <div className="field">
            <label>Payment label</label>
            <input value={recordLabel} onChange={(event) => setRecordLabel(event.target.value)} placeholder="Customer deposit - Fuji test" />
          </div>
          <div className="field">
            <label>Amount in AVAX</label>
            <input value={recordAmount} onChange={(event) => setRecordAmount(event.target.value)} placeholder="0.01" />
          </div>
          <button onClick={recordPayment}>Record Payment</button>
          {recordStatus && <p className="status-text">{recordStatus}</p>}
          {!paymentLogAddress || paymentLogAddress.startsWith('https://') ? <p className="warning">Set VITE_PAYMENT_LOG_ADDRESS or backend PAYMENT_LOG_ADDRESS after deploying PaymentLog.sol.</p> : <a className="inline-link" href={`${config?.snowtraceBaseUrl || 'https://testnet.snowtrace.io'}/address/${paymentLogAddress}`} target="_blank" rel="noreferrer">Open contract on Snowtrace</a>}
        </div>

        <div className="card payments-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Step 5</p>
              <h2>Recent on-chain payments</h2>
            </div>
            <button className="ghost-button" onClick={loadPayments}>Refresh</button>
          </div>
          <PaymentList payments={payments} />
        </div>
      </section>

      <section className="dashboard-grid split">
        <div className="card founder-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Founder checklist</p>
              <h2>What to check this week</h2>
            </div>
          </div>
          <ul className="check-list">
            <li>Reconcile the CSV balance against bank, M-Pesa, and accounting records.</li>
            <li>Confirm the largest inflow customer and whether that concentration is repeatable.</li>
            <li>Review the largest expense and any round-number withdrawals for approval.</li>
            <li>Track cash collected, cash outflow, runway, and days since last inflow weekly.</li>
          </ul>
        </div>

        <div className="card trust-card">
          <div className="card-head">
            <div>
              <p className="eyebrow">Trust controls</p>
              <h2>What makes this MVP safe to demo</h2>
            </div>
          </div>
          <div className="trust-grid">
            <div><strong>No private keys</strong><span>Backend reads chain only; wallet signs in browser.</span></div>
            <div><strong>Server-side AI</strong><span>Gemini key stays in backend environment variables.</span></div>
            <div><strong>Input limits</strong><span>Label length, amount range, row count, and JSON size are constrained.</span></div>
            <div><strong>Honest scope</strong><span>Zoho is simulated via CSV and Fuji is testnet data.</span></div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div>
          <strong>Mizani</strong>
          <span>Kuzana Bounty 1 MVP · Cash-flow risk + Fuji payment log</span>
        </div>
        <p>Simulated Zoho via CSV. Fuji testnet payments are demo data unless independently verified.</p>
      </footer>

      {error && <div className="toast" role="alert">{error}</div>}
    </main>
  );
}
