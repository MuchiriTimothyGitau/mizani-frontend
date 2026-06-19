export const PAYMENT_LOG_ADDRESS = import.meta.env.VITE_PAYMENT_LOG_ADDRESS || '';

export const PAYMENT_LOG_ABI = [
  'event PaymentRecorded(address indexed sender, string label, uint256 amount, uint256 recordedAt)',
  'function recordPayment(string label, uint256 amount) external'
];
