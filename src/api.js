import { Client, Functions } from 'appwrite';

const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID || '');

export const functions = new Functions(client);

async function executeFunc(functionId, body = {}) {
  try {
    const execution = await functions.createExecution({
      functionId,
      body: JSON.stringify(body),
      async: false,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!execution || !execution.responseBody) {
      throw new Error('No response from server');
    }

    const parsed = JSON.parse(execution.responseBody);

    if (execution.statusCode >= 400 || (parsed && parsed.ok === false)) {
      throw new Error(parsed?.error || execution.responseBody || `Server error ${execution.statusCode}`);
    }

    return parsed;
  } catch (error) {
    console.error(`Error executing ${functionId}:`, error);
    throw error;
  }
}

export function fetchConfig() {
  return executeFunc('mizani-core', { action: 'config' });
}

export function fetchPayments() {
  return executeFunc('mizani-core', { action: 'payments' });
}

export function execScoreCsv(transactions) {
  return executeFunc('mizani-core', { action: 'score', transactions });
}

export function execGenerateReport(score) {
  return executeFunc('mizani-generate-report', { score });
}
