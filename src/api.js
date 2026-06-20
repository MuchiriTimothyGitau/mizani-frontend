import { Client, Functions } from 'appwrite';

const client = new Client()
  .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID || '');

export const functions = new Functions(client);

async function executeFunc(functionId, body = {}) {
  try {
    const execution = await functions.createExecution(
      functionId,
      JSON.stringify(body),
      false,
      'POST',
      { 'Content-Type': 'application/json' }
    );
    return JSON.parse(execution.responseBody || '{}');
  } catch (error) {
    console.error(`Error executing ${functionId}:`, error);
    throw error;
  }
}

export function fetchConfig() {
  return executeFunc('mizani-config');
}

export function fetchPayments() {
  return executeFunc('mizani-onchain-payments');
}

export function execScoreCsv(transactions) {
  return executeFunc('mizani-score-csv', { transactions });
}

export function execGenerateReport(score) {
  return executeFunc('mizani-generate-report', { score });
}