const DB_NAME = 'city2cruise-crypto';
const STORE_NAME = 'signing-keys';
const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGORITHM: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

interface StoredSigningKey {
  userId: number;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB no disponible'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStore(mode: IDBTransactionMode) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, mode);
  return { db, tx, store: tx.objectStore(STORE_NAME) };
}

export async function getStoredSigningKey(userId: number): Promise<StoredSigningKey | null> {
  const { db, tx, store } = await getStore('readonly');
  return new Promise((resolve, reject) => {
    const request = store.get(userId);
    request.onsuccess = () => resolve((request.result as StoredSigningKey | undefined) || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveStoredSigningKey(record: StoredSigningKey): Promise<void> {
  const { db, tx, store } = await getStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function generateSigningKeyPair(): Promise<StoredSigningKey> {
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    userId: 0,
    publicKeyJwk,
    privateKeyJwk,
  };
}

export async function ensureLocalSigningKey(userId: number): Promise<StoredSigningKey> {
  const existing = await getStoredSigningKey(userId);
  if (existing) return existing;
  const generated = await generateSigningKeyPair();
  const record = { ...generated, userId };
  await saveStoredSigningKey(record);
  return record;
}

async function importPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', privateKeyJwk, KEY_ALGORITHM, true, ['sign']);
}

export async function signCanonicalMessage(userId: number, canonicalMessage: string): Promise<string> {
  const record = await ensureLocalSigningKey(userId);
  const privateKey = await importPrivateKey(record.privateKeyJwk);
  const signature = await crypto.subtle.sign(SIGN_ALGORITHM, privateKey, new TextEncoder().encode(canonicalMessage));
  const bytes = new Uint8Array(signature);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
