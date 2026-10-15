import { checkDevice, type DeviceKeys, type PublicDevice } from "./crypto";
/** Origin-local IndexedDB holds non-extractable CryptoKeys and independently verified public pins. */
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("travstats-comparison-e2e-v2", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("vault");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function read<T>(key: string): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction("vault").objectStore("vault").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function write(key: string, value: unknown) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("vault", "readwrite");
      tx.objectStore("vault").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const localDevice = (account: string) => read<DeviceKeys>(`${account}:device`);
export const storeDevice = (account: string, keys: DeviceKeys) => write(`${account}:device`, keys);
export const pinnedDevices = async (account: string): Promise<Record<string, PublicDevice>> =>
  (await read(`${account}:pins`)) ?? {};
export async function pinDevice(
  account: string,
  device: PublicDevice,
  entered: string,
  binding: string
) {
  await checkDevice(device);
  if (entered.replace(/\s/g, "").toLowerCase() !== device.fingerprint)
    throw Error("E2E_FINGERPRINT");
  const pins = await pinnedDevices(account);
  pins[`${binding}:${device.fingerprint}`] = device;
  await write(`${account}:pins`, pins);
}
export async function checkFreshness(
  account: string,
  audience: string,
  sender: string,
  stamp: string,
  publication: string
) {
  const key = `${account}:seen:${audience}:${sender}`;
  const seen = await read<{ stamp: string; publication: string }>(key);
  if (
    seen &&
    (Date.parse(stamp) < Date.parse(seen.stamp) ||
      (stamp === seen.stamp && publication !== seen.publication))
  )
    throw Error("E2E_ROLLBACK");
  await write(key, { stamp, publication });
}
