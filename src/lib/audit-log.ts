export function auditLog(event: {
  action: string;
  apiKeyId?: string;
  riskScore?: number;
  verdict?: string;
  promptLength?: number;
  ip?: string;
  detail?: string;
}): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString(), type: "audit" }));
}
