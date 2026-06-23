const APPWRITE_PROXY = '/api/appwrite';
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '6a366796002ca5f0af34';

async function executeFunc(functionId, body = {}) {
  const url = `${APPWRITE_PROXY}/functions/${functionId}/executions`;
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
  return executeFunc('mizani_core', { action: 'config' });
}

export function fetchPayments() {
  return executeFunc('mizani_core', { action: 'payments' });
}

export function execScoreCsv(transactions) {
  return executeFunc('mizani_core', { action: 'score', transactions });
}

export function execGenerateReport(score) {
  return executeFunc('mizani_generate_report', { score });
}
