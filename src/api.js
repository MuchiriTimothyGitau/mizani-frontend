const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '6a366796002ca5f0af34';

const CORE_FUNCTION_ID = '6a3a767c00079ee24e27';
const REPORT_FUNCTION_ID = '6a3a77c4001927f93b5a';

async function executeFunc(functionId, body = {}) {
  const url = `/api/proxy?path=functions/${functionId}/executions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Appwrite-Project': PROJECT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      body: JSON.stringify(body),
      async: false,
      method: 'POST'
    })
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
  }

  return data;
}

export function fetchConfig() {
  return executeFunc(CORE_FUNCTION_ID, { action: 'config' });
}

export function fetchPayments() {
  return executeFunc(CORE_FUNCTION_ID, { action: 'payments' });
}

export function execScoreCsv(transactions) {
  return executeFunc(CORE_FUNCTION_ID, { action: 'score', transactions });
}

export function execGenerateReport(score) {
  return executeFunc(REPORT_FUNCTION_ID, { score });
}
