type ServerFn = ((input?: any) => Promise<any>) & { url?: string };

function stub(value: any = null): ServerFn {
  const fn = (async () => value) as ServerFn;
  fn.url = "/__local_stub__";
  return fn;
}

export const checkLowStockAlert = stub({ ok: true });
export const sendViberTest = stub({ ok: false, error: "Server functions are disabled in local client preview." });
export const sendOrderRequestAlert = stub({ ok: true });
export const submitOrderRequest = stub({ ok: true });
export const sendReportLinkSms = stub({ ok: true });

export const scanProductImage = stub({ name: "", sku: "", barcode: "" });
export const getStrichLicense = stub({ licenseKey: "" });
export const reportKeyError = stub({ ok: true });
export async function alertKeyError() { return { ok: true }; }
export function looksLikeKeyError() { return false; }

export const listAuditLogs = stub({ rows: [], total: 0 });

export const listManagedUsers = stub([]);
export const createManagedUser = stub({ ok: false, error: "Disabled in local client preview." });
export const inviteManagedUser = stub({ ok: false, error: "Disabled in local client preview." });
export const changeOwnPin = stub({ ok: false, error: "Disabled in local client preview." });
export const resetUserPin = stub({ ok: false, error: "Disabled in local client preview." });
export const setUserRole = stub({ ok: false, error: "Disabled in local client preview." });
export const deleteManagedUser = stub({ ok: false, error: "Disabled in local client preview." });

export const decideOrderRequest = stub({ ok: true });
export const updateShipment = stub({ ok: true });
export const markShipmentArrived = stub({ ok: true });
export const logContainer = stub({ ok: true });

export const listBackups = stub([]);
export const getBackupDownloadUrl = stub({ url: "" });
export const runBackupNow = stub({ ok: false, error: "Disabled in local client preview." });
export const runMirrorNow = stub({ ok: false, error: "Disabled in local client preview." });
export const listMirrorLogs = stub([]);
export const deleteBackup = stub({ ok: false, error: "Disabled in local client preview." });

export const generateStockInsights = stub({ insights: [] });
export const uploadProductImageFile = stub({ url: "" });
export const cleanProductImageAI = stub({ url: "" });
